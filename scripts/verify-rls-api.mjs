import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentProjectRef = 'zysyghbbbesatbehravb';
const results = [];
const retainedStoragePaths = new Set();
const pendingStorageCleanupPaths = new Set();
const requiredTests = [
  'User A reads own permitted profile fields',
  'User A reads own standard role',
  'User A reads own subscription',
  'User B fixture is a standard account',
  'User A cannot promote own role to admin',
  'User A cannot activate Premium directly',
  'User A creates a valid recording owned by themselves',
  'User A can use INSERT RETURNING id',
  'User B cannot read User A private recording',
  'User B cannot modify User A recording',
  'Free User A cannot create an edited version',
  'Ordinary user cannot create a license directly',
  'Authenticated user can see published marketplace listings',
  'Draft and archived listings stay out of marketplace summaries',
  'User A uploads and saves one private original',
  'User A sees the saved recording in My Library',
  'User B cannot see User A recordings in My Library',
  'User A can download their own private audio',
  'User B cannot read or download User A private audio by path',
  'User B cannot claim, overwrite, or delete User A private audio',
  'Anonymous upload and download are denied',
  'Unsupported MIME uploads are denied',
  'MIME and extension mismatches are denied',
  'Oversized audio uploads are denied',
  'Direct original metadata without a matching object is denied',
  'Duplicate original versions are denied',
  'Repeated RPC submission does not create extra metadata rows',
  'Metadata failure permits safe cleanup of an unreferenced upload',
  'RPC rejects uploaded-object MIME and size mismatches',
  'Referenced original deletion is denied',
  'Owner can remove an unreferenced upload',
];

class CheckFailure extends Error {}

function report(name, status, detail = '') {
  results.push({ name, status });
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(reason) {
  return { skip: reason };
}

function trackStorageTestPath(path) {
  pendingStorageCleanupPaths.add(path);
  console.log(`echovault-dev Storage test path: ${path}`);
}

function makeWavFixture(sampleValue = 0, mimeType = 'audio/wav') {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2 * 1.25;
  const buffer = Buffer.alloc(44 + dataSize, sampleValue);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return new Blob([buffer], { type: mimeType });
}

function makeOversizedAudioFixture() {
  return new Blob([Buffer.alloc(20 * 1024 * 1024 + 1)], { type: 'audio/wav' });
}

function isStorageDenial(error) {
  const status = Number(error?.status)
  return Boolean(
    error &&
      (isAuthorizationDenied(error) || status === 400 || status === 404)
  );
}

function includesStoragePath(objects, path) {
  return Array.isArray(objects) && objects.some((object) => object?.name === path)
}

function parseEnvValue(contents, name) {
  const line = contents.split(/\r?\n/).find((entry) => {
    const match = entry.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match?.[1] === name;
  });
  if (!line) return null;

  const value = line.slice(line.indexOf('=') + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseProjectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CheckFailure('A Supabase URL is missing or invalid.');
  }

  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CheckFailure('Expected an HTTPS Supabase project URL.');
  }

  return url;
}

function isPublishableKey(value) {
  if (value.startsWith('sb_publishable_')) return true;

  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

async function confirmDevelopmentTarget() {
  const names = [
    'SUPABASE_TEST_URL',
    'SUPABASE_TEST_PUBLISHABLE_KEY',
    'RLS_USER_A_EMAIL',
    'RLS_USER_A_PASSWORD',
    'RLS_USER_B_EMAIL',
    'RLS_USER_B_PASSWORD',
  ];
  let testEnvContents;
  try {
    testEnvContents = await readFile(
      path.join(projectRoot, 'supabase', 'tests', '.env.rls-test.local'),
      'utf8',
    );
  } catch {
    throw new CheckFailure('The local RLS test environment file is unavailable.');
  }
  const testEnv = Object.fromEntries(
    names.map((name) => [name, parseEnvValue(testEnvContents, name)]),
  );
  const missing = names.filter((name) => !testEnv[name]);
  if (missing.length) {
    throw new CheckFailure(`Missing required environment variables: ${missing.join(', ')}.`);
  }
  const overridden = names.filter((name) => process.env[name] !== testEnv[name]);
  if (overridden.length) {
    throw new CheckFailure(
      `Runtime values do not match supabase/tests/.env.rls-test.local: ${overridden.join(', ')}.`,
    );
  }

  const testUrl = parseProjectUrl(testEnv.SUPABASE_TEST_URL);
  if (!isPublishableKey(testEnv.SUPABASE_TEST_PUBLISHABLE_KEY)) {
    throw new CheckFailure('The configured key is not a publishable/anon key; refusing to connect.');
  }

  let appEnv;
  try {
    appEnv = await readFile(path.join(projectRoot, '.env.local'), 'utf8');
  } catch {
    throw new CheckFailure('Cannot verify the configured development project: .env.local is unavailable.');
  }
  const appUrlValue = parseEnvValue(appEnv, 'VITE_SUPABASE_URL');
  if (!appUrlValue) {
    throw new CheckFailure('Cannot verify the configured development project: VITE_SUPABASE_URL is missing.');
  }
  const appUrl = parseProjectUrl(appUrlValue);
  const testProjectRef = testUrl.hostname.split('.')[0];
  const appProjectRef = appUrl.hostname.split('.')[0];
  if (testProjectRef !== developmentProjectRef || appProjectRef !== developmentProjectRef) {
    throw new CheckFailure('The app and test URLs must both target the configured echovault-dev project.');
  }

  console.log(`Verified echovault-dev project reference: ${testProjectRef}`);
  console.log('This run creates private recording and Storage fixtures that ordinary clients cannot delete while referenced.');
  let confirmation;
  if (process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      confirmation = await terminal.question('Type echovault-dev to continue: ');
    } finally {
      terminal.close();
    }
  } else if (process.argv.includes('--confirm-echovault-dev')) {
    confirmation = 'echovault-dev';
  } else {
    throw new CheckFailure(
      'Use an interactive echovault-dev confirmation or the explicit --confirm-echovault-dev flag; no network request was made.'
    );
  }
  if (confirmation.trim() !== 'echovault-dev') {
    throw new CheckFailure('Development-project confirmation did not match; no network request was made.');
  }

  return {
    url: testUrl.toString().replace(/\/$/, ''),
    key: testEnv.SUPABASE_TEST_PUBLISHABLE_KEY,
    env: testEnv,
  };
}

function makeClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function apiErrorCode(error) {
  return error?.code ? `SQL/API code ${error.code}` : 'an API error without a code';
}

function authFailureDiagnostic(userLabel, error, env) {
  let message = typeof error?.message === 'string' ? error.message : 'No safe Auth error message was provided.';
  const secretValues = [
    env.SUPABASE_TEST_URL,
    env.SUPABASE_TEST_PUBLISHABLE_KEY,
    env.RLS_USER_A_EMAIL,
    env.RLS_USER_A_PASSWORD,
    env.RLS_USER_B_EMAIL,
    env.RLS_USER_B_PASSWORD,
  ];
  for (const secret of secretValues) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]');
  }
  message = message
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/gi, '[REDACTED KEY]')
    .replace(/\b(?:access|refresh|id)[_-]?token\b\s*[:=]\s*[^\s,;]+/gi, '[REDACTED TOKEN]')
    .replace(/\bapi[_ -]?key\b\s*[:=]\s*[^\s,;]+/gi, '[REDACTED KEY]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!message) message = 'No safe Auth error message was provided.';
  if (message.length > 240) message = `${message.slice(0, 237)}...`;

  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const codeIsSecret = secretValues.some((secret) => secret && secret === rawCode);
  const code =
    !codeIsSecret &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) &&
    !/^(?:sb_|eyJ)/i.test(rawCode)
      ? rawCode
      : 'not provided';
  const status = Number.isInteger(error?.status) ? `; HTTP status: ${error.status}` : '';
  return `User ${userLabel} sign-in failed; Auth error code: ${code}; message: ${message}${status}.`;
}

function isAuthorizationDenied(error) {
  return error?.code === '42501' || error?.status === 401 || error?.status === 403;
}

function requireNoApiError(error, operation) {
  if (error) throw new CheckFailure(`${operation} failed (${apiErrorCode(error)}).`);
}

async function removeConfirmedUnreferencedAudio(client, path) {
  const { data: version, error: versionError } = await client
    .from('voice_versions')
    .select('id')
    .eq('storage_path', path)
    .maybeSingle();
  requireNoApiError(versionError, `Checking whether ${path} is referenced`);
  if (version) {
    throw new CheckFailure(`The uploaded path ${path} is referenced; cleanup was not attempted.`);
  }

  const { data, error } = await client.storage.from('voice-files').remove([path]);
  requireNoApiError(error, `Removing confirmed unreferenced upload ${path}`);
  if (!includesStoragePath(data, path)) {
    throw new CheckFailure(`Storage did not confirm removal of unreferenced object ${path}.`);
  }
  pendingStorageCleanupPaths.delete(path);
  retainedStoragePaths.delete(path);
}

async function runTest(name, operation) {
  try {
    const outcome = await operation();
    if (outcome?.skip) report(name, 'SKIP', outcome.skip);
    else report(name, 'PASS');
  } catch (error) {
    report(
      name,
      'FAIL',
      error instanceof CheckFailure ? error.message : 'Unexpected test error; details withheld.',
    );
  }
}

async function readOwnRole(client, userId) {
  const { data, error } = await client
    .from('user_roles')
    .select('user_id,role')
    .eq('user_id', userId)
    .maybeSingle();
  requireNoApiError(error, 'Reading own role');
  return data;
}

async function readOwnSubscription(client, userId) {
  const { data, error } = await client
    .from('subscriptions')
    .select('user_id,plan,expires_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  requireNoApiError(error, 'Reading own subscription');
  return data;
}

function timestampsMatch(left, right) {
  if (left === null || right === null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

async function restoreRecordingTitle(client, recordingId, title) {
  const { error } = await client
    .from('voice_recordings')
    .update({ title })
    .eq('id', recordingId);
  return !error;
}

async function restoreRole(client, userId, role) {
  const { error } = await client
    .from('user_roles')
    .update({ role })
    .eq('user_id', userId);
  return !error;
}

async function restoreSubscription(client, userId, subscription) {
  const { error } = await client
    .from('subscriptions')
    .update({ plan: subscription.plan, expires_at: subscription.expires_at })
    .eq('user_id', userId);
  return !error;
}

async function signOutLocally(client, label) {
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) console.warn(`WARN Could not clear ${label} in-memory Auth session (${apiErrorCode(error)}).`);
  } catch {
    console.warn(`WARN Could not clear ${label} in-memory Auth session.`);
  }
}

async function main() {
  let clientA;
  let clientB;
  let signedInA = false;
  let signedInB = false;
  let userA;
  let userB;
  let roleA;
  let subscriptionA;
  let userBIsStandard = false;
  let recording;
  let marketplaceRows = [];
  let fixtureListings;
  let storageFixture;
  let anonymousClient;

  try {
    let config;
    try {
      config = await confirmDevelopmentTarget();
    } catch (error) {
      report(
        'Development project and publishable-key preflight',
        'FAIL',
        error instanceof CheckFailure ? error.message : 'Preflight failed; details withheld.',
      );
      for (const test of requiredTests) report(test, 'SKIP', 'Preflight did not pass.');
      return;
    }

    clientA = makeClient(config.url, config.key);
    clientB = makeClient(config.url, config.key);
    anonymousClient = makeClient(config.url, config.key);

    const signInA = await clientA.auth.signInWithPassword({
      email: config.env.RLS_USER_A_EMAIL,
      password: config.env.RLS_USER_A_PASSWORD,
    });
    if (signInA.error || !signInA.data.user) {
      report(
        'Sign in to two independent Supabase Auth sessions',
        'FAIL',
        authFailureDiagnostic('A', signInA.error ?? { message: 'No user was returned.' }, config.env),
      );
      for (const test of requiredTests) report(test, 'SKIP', 'Authentication did not complete.');
      return;
    }
    signedInA = true;
    userA = signInA.data.user;

    const signInB = await clientB.auth.signInWithPassword({
      email: config.env.RLS_USER_B_EMAIL,
      password: config.env.RLS_USER_B_PASSWORD,
    });
    if (signInB.error || !signInB.data.user) {
      report(
        'Sign in to two independent Supabase Auth sessions',
        'FAIL',
        authFailureDiagnostic('B', signInB.error ?? { message: 'No user was returned.' }, config.env),
      );
      for (const test of requiredTests) report(test, 'SKIP', 'Authentication did not complete.');
      return;
    }
    signedInB = true;
    userB = signInB.data.user;

    if (userA.id === userB.id) {
      report('Sign in to two independent Supabase Auth sessions', 'FAIL', 'Both credentials resolved to the same user.');
      for (const test of requiredTests) report(test, 'SKIP', 'Distinct authenticated identities are required.');
      return;
    }
    report('Sign in to two independent Supabase Auth sessions', 'PASS');

    await runTest('User A reads own permitted profile fields', async () => {
      const { data, error } = await clientA
        .from('profiles')
        .select('id,display_name')
        .eq('id', userA.id)
        .maybeSingle();
      requireNoApiError(error, 'Reading own profile');
      if (!data || data.id !== userA.id || typeof data.display_name !== 'string') {
        throw new CheckFailure('The expected own-profile row or permitted fields were not returned.');
      }
    });

    await runTest('User A reads own standard role', async () => {
      roleA = await readOwnRole(clientA, userA.id);
      if (!roleA) throw new CheckFailure('User A has no bootstrap role row.');
      if (roleA.role !== 'user') {
        throw new CheckFailure('User A is not configured with the expected standard user role.');
      }
    });

    await runTest('User A reads own subscription', async () => {
      subscriptionA = await readOwnSubscription(clientA, userA.id);
      if (!subscriptionA) throw new CheckFailure('User A has no bootstrap subscription row.');
    });

    await runTest('User B fixture is a standard account', async () => {
      const role = await readOwnRole(clientB, userB.id);
      if (!role) throw new CheckFailure('User B has no bootstrap role row.');
      if (role.role !== 'user') return skip('User B is not a standard user; cross-user denial checks would be misleading.');
      userBIsStandard = true;
    });

    await runTest('User A cannot promote own role to admin', async () => {
      if (roleA?.role !== 'user') return skip('Requires User A to have the standard user role.');

      const { error } = await clientA
        .from('user_roles')
        .update({ role: 'admin' })
        .eq('user_id', userA.id);
      if (error && !isAuthorizationDenied(error)) {
        throw new CheckFailure(`Role update failed for an unexpected reason (${apiErrorCode(error)}).`);
      }

      const persisted = await readOwnRole(clientA, userA.id);
      if (persisted?.role !== 'user') {
        const restored = await restoreRole(clientA, userA.id, 'user');
        throw new CheckFailure(
          restored
            ? 'The role changed to admin; the script restored it to user.'
            : 'The role changed and could not be restored through this client; repair the disposable test account.',
        );
      }
    });

    await runTest('User A cannot activate Premium directly', async () => {
      if (!subscriptionA) return skip('Requires User A subscription data.');
      if (subscriptionA.plan !== 'free') return skip('Requires a free-plan User A fixture.');

      const attemptedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await clientA
        .from('subscriptions')
        .update({ plan: 'premium', expires_at: attemptedExpiry })
        .eq('user_id', userA.id);
      if (error && !isAuthorizationDenied(error)) {
        throw new CheckFailure(`Subscription update failed for an unexpected reason (${apiErrorCode(error)}).`);
      }

      const persisted = await readOwnSubscription(clientA, userA.id);
      if (
        persisted?.plan !== subscriptionA.plan ||
        !timestampsMatch(persisted?.expires_at ?? null, subscriptionA.expires_at)
      ) {
        const restored = await restoreSubscription(clientA, userA.id, subscriptionA);
        throw new CheckFailure(
          restored
            ? 'The subscription changed; the script restored the original plan and expiry.'
            : 'The subscription changed and could not be restored through this client; repair the disposable test account.',
        );
      }
    });

    try {
      const title = `RLS API verification ${randomUUID()}`;
      const { data, error } = await clientA
        .from('voice_recordings')
        .insert({
          owner_id: userA.id,
          title,
          description: 'Disposable private API RLS test fixture.',
          category: 'test',
          visibility: 'private',
        })
        .select('id,owner_id,title')
        .single();
      requireNoApiError(error, 'Creating a private recording with RETURNING');
      if (!data?.id || data.owner_id !== userA.id || data.title !== title) {
        throw new CheckFailure('The returned recording did not match User A and the submitted fixture.');
      }
      recording = data;
      report('User A creates a valid recording owned by themselves', 'PASS');
      report('User A can use INSERT RETURNING id', 'PASS');
    } catch (error) {
      const detail = error instanceof CheckFailure ? error.message : 'Unexpected insert error; details withheld.';
      report('User A creates a valid recording owned by themselves', 'FAIL', detail);
      report('User A can use INSERT RETURNING id', 'FAIL', detail);
    }

    await runTest('User B cannot read User A private recording', async () => {
      if (!userBIsStandard) return skip('Requires User B to be a standard account.');
      if (!recording) return skip('A private recording fixture was not created.');

      const { data, error } = await clientB
        .from('voice_recordings')
        .select('id,owner_id,title')
        .eq('id', recording.id)
        .maybeSingle();
      requireNoApiError(error, 'Reading another user private recording');
      if (data) throw new CheckFailure('User B received User A private recording data.');
    });

    await runTest('User B cannot modify User A recording', async () => {
      if (!userBIsStandard) return skip('Requires User B to be a standard account.');
      if (!recording) return skip('A private recording fixture was not created.');

      const { error } = await clientB
        .from('voice_recordings')
        .update({ title: 'Unauthorized RLS API modification' })
        .eq('id', recording.id);
      if (error && !isAuthorizationDenied(error)) {
        throw new CheckFailure(`Cross-user update failed for an unexpected reason (${apiErrorCode(error)}).`);
      }

      const { data, error: readError } = await clientA
        .from('voice_recordings')
        .select('id,owner_id,title')
        .eq('id', recording.id)
        .maybeSingle();
      requireNoApiError(readError, 'Verifying the recording after User B update attempt');
      if (data?.title !== recording.title) {
        const restored = await restoreRecordingTitle(clientA, recording.id, recording.title);
        throw new CheckFailure(
          restored
            ? 'User B changed the recording; the script restored its original title.'
            : 'User B changed the recording and it could not be restored; repair the disposable fixture.',
        );
      }
    });

    await runTest('Free User A cannot create an edited version', async () => {
      if (roleA?.role !== 'user') return skip('Requires User A to have the standard user role.');
      if (subscriptionA?.plan !== 'free') return skip('Requires a free-plan User A fixture.');
      if (!recording) return skip('A valid User A recording fixture was not created.');

      const { data, error } = await clientA
        .from('voice_versions')
        .insert({
          recording_id: recording.id,
          effect_type: 'muffle',
          effect_settings: {},
          storage_path: `${userA.id}/${randomUUID()}.wav`,
          duration_seconds: 1.25,
          mime_type: 'audio/wav',
          file_size_bytes: 1024,
        })
        .select('id')
        .single();
      if (error) {
        if (isAuthorizationDenied(error)) return;
        throw new CheckFailure(`Edited-version insert failed for an unexpected reason (${apiErrorCode(error)}).`);
      }
      if (data?.id) {
        throw new CheckFailure(
          'The edited version was unexpectedly created; it is immutable through ordinary client policies and may need trusted cleanup.',
        );
      }
      throw new CheckFailure('No row or authorization error was returned; denial was not established.');
    });

    await runTest('Authenticated user can see published marketplace listings', async () => {
      if (roleA?.role !== 'user') return skip('Requires User A to be a standard authenticated user.');
      if (!userBIsStandard) return skip('Requires User B to be a standard seller account.');
      const previewPath = `${userB.id}/rls-api-test-fixture-published.preview`;
      const columns =
        'listing_id,version_id,recording_id,title,seller_id,seller_display_name,preview_path,sale_price_cents,rental_price_cents';

      const { data: sellerRow, error: sellerRowError } = await clientB
        .from('listings')
        .select('id,version_id,status,preview_path,sale_price_cents,rental_price_cents')
        .eq('preview_path', previewPath)
        .maybeSingle();
      requireNoApiError(sellerRowError, 'Verifying the published fixture as its seller');
      if (!sellerRow) return skip('Run rls_api_fixtures.sql; its published listing fixture is missing.');
      if (
        sellerRow.status !== 'published' ||
        !sellerRow.version_id ||
        sellerRow.preview_path !== previewPath ||
        !(Number.isInteger(sellerRow.sale_price_cents) && sellerRow.sale_price_cents > 0) ||
        !(Number.isInteger(sellerRow.rental_price_cents) && sellerRow.rental_price_cents > 0)
      ) {
        throw new CheckFailure('The seller-owned fixture is not a valid published listing.');
      }

      const { data: sellerVersion, error: versionError } = await clientB
        .from('voice_versions')
        .select('id,recording_id,effect_type')
        .eq('id', sellerRow.version_id)
        .maybeSingle();
      requireNoApiError(versionError, 'Verifying the published fixture version as its owner');
      if (!sellerVersion || sellerVersion.effect_type !== 'original') {
        throw new CheckFailure('The published fixture does not reference its expected original version.');
      }

      const { data: sellerRecording, error: recordingError } = await clientB
        .from('voice_recordings')
        .select('id,owner_id,visibility')
        .eq('id', sellerVersion.recording_id)
        .maybeSingle();
      requireNoApiError(recordingError, 'Verifying the published fixture recording as its owner');
      if (
        !sellerRecording ||
        sellerRecording.owner_id !== userB.id ||
        sellerRecording.visibility !== 'public'
      ) {
        throw new CheckFailure('The fixture source recording is not public and owned by the designated seller.');
      }

      const { data: buyerListing, error } = await clientA
        .from('marketplace_listing_summaries')
        .select(columns)
        .eq('preview_path', previewPath)
        .maybeSingle();
      requireNoApiError(error, 'Reading the published fixture as User A');
      if (!buyerListing) {
        throw new CheckFailure('User A could not see a valid published public fixture in the marketplace view.');
      }
      if (
        buyerListing.seller_id !== userB.id ||
        buyerListing.listing_id !== sellerRow.id ||
        buyerListing.version_id !== sellerVersion.id ||
        buyerListing.recording_id !== sellerRecording.id ||
        !buyerListing.listing_id ||
        !buyerListing.version_id ||
        !buyerListing.recording_id ||
        !buyerListing.preview_path ||
        buyerListing.sale_price_cents !== sellerRow.sale_price_cents ||
        buyerListing.rental_price_cents !== sellerRow.rental_price_cents
      ) {
        throw new CheckFailure('The published fixture did not return valid seller, version, preview, and pricing data.');
      }

      const { data: sellerListing, error: sellerError } = await clientB
        .from('marketplace_listing_summaries')
        .select(columns)
        .eq('preview_path', previewPath)
        .maybeSingle();
      requireNoApiError(sellerError, 'Reading the published fixture as User B');
      if (sellerListing?.listing_id !== buyerListing.listing_id || sellerListing.seller_id !== userB.id) {
        throw new CheckFailure('The authenticated seller could not read the published fixture summary.');
      }

      marketplaceRows = [buyerListing];
    });

    await runTest('Draft and archived listings stay out of marketplace summaries', async () => {
      if (!userBIsStandard) return skip('Requires User B to be a standard seller account.');
      const draftPath = `${userB.id}/rls-api-test-fixture-draft.preview`;
      const archivedPath = `${userB.id}/rls-api-test-fixture-archived.preview`;

      const { data: sellerListings, error } = await clientB
        .from('listings')
        .select('id,status,preview_path')
        .in('preview_path', [draftPath, archivedPath]);
      requireNoApiError(error, 'Reading draft/archive fixtures as their seller');
      const draft = sellerListings?.find((listing) => listing.preview_path === draftPath);
      const archived = sellerListings?.find((listing) => listing.preview_path === archivedPath);
      if (!draft || !archived) {
        return skip('Run rls_api_fixtures.sql; the seller-owned draft or archived fixture is missing.');
      }
      if (draft.status !== 'draft' || archived.status !== 'archived') {
        throw new CheckFailure('The seller fixture rows do not have the expected draft and archived statuses.');
      }

      for (const fixture of [draft, archived]) {
        const { data: tableRow, error: tableError } = await clientA
          .from('listings')
          .select('id,status')
          .eq('id', fixture.id)
          .maybeSingle();
        if (tableError && !isAuthorizationDenied(tableError)) {
          throw new CheckFailure(`Buyer listing query failed (${apiErrorCode(tableError)}).`);
        }
        if (tableRow) {
          throw new CheckFailure(`User A could read the seller's ${fixture.status} listing from public.listings.`);
        }

        const { data: summaryRow, error: viewError } = await clientA
          .from('marketplace_listing_summaries')
          .select('listing_id')
          .eq('listing_id', fixture.id)
          .maybeSingle();
        requireNoApiError(viewError, `Checking ${fixture.status} marketplace summary visibility`);
        if (summaryRow) {
          throw new CheckFailure(`The seller's ${fixture.status} listing appeared in marketplace summaries.`);
        }
      }
    });

    await runTest('Ordinary user cannot create a license directly', async () => {
      if (roleA?.role !== 'user') return skip('Requires User A to have the standard user role.');
      if (!marketplaceRows.length) return skip('Requires an existing published listing fixture.');

      let candidate;
      for (const listing of marketplaceRows) {
        if (listing.seller_id === userA.id) continue;

        const { data: existingBuys, error: licenseError } = await clientA
          .from('licenses')
          .select('listing_id,license_type')
          .eq('buyer_id', userA.id)
          .eq('listing_id', listing.listing_id)
          .eq('license_type', 'buy')
          .limit(1);
        requireNoApiError(licenseError, 'Checking for an existing permanent-buy fixture');
        if (existingBuys?.length) continue;

        if (Number.isInteger(listing.sale_price_cents) && listing.sale_price_cents > 0) {
          candidate = {
            listing_id: listing.listing_id,
            buyer_id: userA.id,
            license_type: 'buy',
            price_cents: listing.sale_price_cents,
            expires_at: null,
          };
          break;
        }
        if (Number.isInteger(listing.rental_price_cents) && listing.rental_price_cents > 0) {
          candidate = {
            listing_id: listing.listing_id,
            buyer_id: userA.id,
            license_type: 'rent',
            price_cents: listing.rental_price_cents,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          };
          break;
        }
      }

      if (!candidate) {
        return skip('No other-seller published listing with a valid, non-duplicate price fixture is available.');
      }

      const { data, error } = await clientA
        .from('licenses')
        .insert(candidate)
        .select('id')
        .single();
      if (error) {
        if (isAuthorizationDenied(error)) return;
        throw new CheckFailure(`License insert failed for an unexpected reason (${apiErrorCode(error)}).`);
      }
      if (data?.id) {
        throw new CheckFailure(
          'A license was unexpectedly created and cannot be deleted through the ordinary client; remove it through a trusted development-only process.',
        );
      }
      throw new CheckFailure('No row or authorization error was returned; denial was not established.');
    });

    await runTest('User A uploads and saves one private original', async () => {
      if (roleA?.role !== 'user') return skip('Requires User A to have the standard user role.');

      const audio = makeWavFixture(0);
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const { error: uploadError } = await clientA.storage.from('voice-files').upload(path, audio, {
        contentType: 'audio/wav',
        upsert: false,
      });
      requireNoApiError(uploadError, `Uploading a private original fixture at ${path}`);

      const { data, error } = await clientA.rpc('create_original_voice_recording', {
        p_title: `RLS Storage API verification ${randomUUID()}`,
        p_category: 'test',
        p_description: 'Disposable private original Storage API fixture.',
        p_storage_path: path,
        p_mime_type: 'audio/wav',
        p_file_size_bytes: audio.size,
        p_duration_seconds: 1.25,
      });

      if (error) {
        const status = Number(error.status);
        if (Number.isInteger(status) && status >= 400 && status < 500) {
          await removeConfirmedUnreferencedAudio(clientA, path);
        }
        throw new CheckFailure(`Atomic metadata RPC failed (${apiErrorCode(error)}).`);
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.recording_id || !result?.version_id) {
        throw new CheckFailure(
          'The RPC result was uncertain; cleanup was not attempted to avoid deleting a referenced object.'
        );
      }

      storageFixture = {
        audio,
        path,
        recordingId: result.recording_id,
        versionId: result.version_id,
      };
      pendingStorageCleanupPaths.delete(path);
      retainedStoragePaths.add(path);
    });

    await runTest('User A sees the saved recording in My Library', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data: recordingRow, error: recordingError } = await clientA
        .from('voice_recordings')
        .select('id,owner_id,title,category,created_at')
        .eq('id', storageFixture.recordingId)
        .eq('owner_id', userA.id)
        .maybeSingle();
      requireNoApiError(recordingError, 'Reading the saved library recording');

      const { data: versions, error: versionError } = await clientA
        .from('voice_versions')
        .select('id,recording_id,effect_type,storage_path,duration_seconds,mime_type,file_size_bytes')
        .eq('recording_id', storageFixture.recordingId)
        .eq('effect_type', 'original');
      requireNoApiError(versionError, 'Reading the saved original version');

      if (
        !recordingRow ||
        recordingRow.owner_id !== userA.id ||
        versions?.length !== 1 ||
        versions[0].id !== storageFixture.versionId ||
        versions[0].storage_path !== storageFixture.path
      ) {
        throw new CheckFailure('The library did not return exactly one owned original recording and version.');
      }
    });

    await runTest('User B cannot see User A recordings in My Library', async () => {
      if (!userBIsStandard) return skip('Requires User B to have the standard user role.');
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data, error } = await clientB
        .from('voice_recordings')
        .select('id,owner_id')
        .eq('owner_id', userA.id)
        .eq('id', storageFixture.recordingId);
      requireNoApiError(error, 'Checking User B library visibility');
      if (data?.length) {
        throw new CheckFailure('User B saw User A private recordings in My Library.');
      }
    });

    await runTest('User A can download their own private audio', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data, error } = await clientA.storage
        .from('voice-files')
        .download(storageFixture.path);
      requireNoApiError(error, 'Downloading an owned private audio object');
      if (!data || data.size !== storageFixture.audio.size) {
        throw new CheckFailure('The owner download did not return the uploaded audio.');
      }
    });

    await runTest('User B cannot read or download User A private audio by path', async () => {
      if (!userBIsStandard) return skip('Requires User B to have the standard user role.');
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data, error } = await clientB.storage
        .from('voice-files')
        .download(storageFixture.path);
      if (!isStorageDenial(error) || data) {
        throw new CheckFailure('User B received User A private audio or the denial was not established.');
      }
    });

    await runTest('User B cannot claim, overwrite, or delete User A private audio', async () => {
      if (!userBIsStandard) return skip('Requires User B to have the standard user role.');
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const attemptedClaim = await clientB.rpc('create_original_voice_recording', {
        p_title: 'Unauthorized ownership attempt',
        p_category: 'test',
        p_description: '',
        p_storage_path: storageFixture.path,
        p_mime_type: 'audio/wav',
        p_file_size_bytes: storageFixture.audio.size,
        p_duration_seconds: 1.25,
      });
      if (!isAuthorizationDenied(attemptedClaim.error)) {
        throw new CheckFailure('The RPC did not reject User B claiming User A private audio.');
      }

      const overwrite = await clientB.storage.from('voice-files').upload(
        storageFixture.path,
        makeWavFixture(32),
        { contentType: 'audio/wav', upsert: true },
      );
      if (!isStorageDenial(overwrite.error)) {
        throw new CheckFailure('User B was not denied an overwrite attempt.');
      }

      const deletion = await clientB.storage.from('voice-files').remove([storageFixture.path]);
      if (deletion.error && !isStorageDenial(deletion.error)) {
        throw new CheckFailure(`User B delete attempt failed unexpectedly (${apiErrorCode(deletion.error)}).`);
      }

      const ownerDownload = await clientA.storage
        .from('voice-files')
        .download(storageFixture.path);
      requireNoApiError(ownerDownload.error, 'Verifying the object after User B mutation attempts');
      if (!ownerDownload.data || ownerDownload.data.size !== storageFixture.audio.size) {
        throw new CheckFailure('User B changed or removed User A private audio.');
      }
    });

    await runTest('Anonymous upload and download are denied', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const anonymousPath = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(anonymousPath);
      const upload = await anonymousClient.storage.from('voice-files').upload(
        anonymousPath,
        makeWavFixture(),
        { contentType: 'audio/wav', upsert: false },
      );
      if (!isStorageDenial(upload.error)) {
        if (!upload.error) {
          await removeConfirmedUnreferencedAudio(clientA, anonymousPath);
        }
        throw new CheckFailure('Anonymous Storage upload was not denied.');
      }
      pendingStorageCleanupPaths.delete(anonymousPath);

      const download = await anonymousClient.storage
        .from('voice-files')
        .download(storageFixture.path);
      if (!isStorageDenial(download.error) || download.data) {
        throw new CheckFailure('Anonymous private audio download was not denied.');
      }
    });

    await runTest('Unsupported MIME uploads are denied', async () => {
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage
        .from('voice-files')
        .upload(path, makeWavFixture(0, 'audio/aac'), { upsert: false });
      const status = Number(upload.error?.status ?? upload.error?.statusCode);
      if (!upload.error || status !== 400) {
        await removeConfirmedUnreferencedAudio(clientA, path);
        throw new CheckFailure('Storage accepted an unsupported audio MIME type.');
      }
      pendingStorageCleanupPaths.delete(path);
    });

    await runTest('MIME and extension mismatches are denied', async () => {
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage
        .from('voice-files')
        .upload(path, makeWavFixture(0, 'audio/mpeg'), { upsert: false });
      const status = Number(upload.error?.status ?? upload.error?.statusCode);
      if (![400, 403].includes(status)) {
        await removeConfirmedUnreferencedAudio(clientA, path);
        throw new CheckFailure('Storage did not reject an MP3 MIME type with a WAV extension.');
      }
      pendingStorageCleanupPaths.delete(path);
    });

    await runTest('Oversized audio uploads are denied', async () => {
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage.from('voice-files').upload(
        path,
        makeOversizedAudioFixture(),
        { contentType: 'audio/wav', upsert: false },
      );
      const status = Number(upload.error?.status ?? upload.error?.statusCode);
      if (!upload.error || ![400, 413].includes(status)) {
        await removeConfirmedUnreferencedAudio(clientA, path);
        throw new CheckFailure('Storage did not reject audio larger than the 20 MiB bucket limit.');
      }
      pendingStorageCleanupPaths.delete(path);
    });

    await runTest('Direct original metadata without a matching object is denied', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data, error } = await clientA
        .from('voice_versions')
        .insert({
          recording_id: storageFixture.recordingId,
          effect_type: 'original',
          effect_settings: {},
          storage_path: `${userA.id}/${randomUUID()}.wav`,
          duration_seconds: 1.25,
          mime_type: 'audio/wav',
          file_size_bytes: 1000,
        })
        .select('id')
        .single();

      if (!isAuthorizationDenied(error) || data) {
        throw new CheckFailure('Direct original insertion bypassed uploaded-object validation.');
      }
    });

    await runTest('Duplicate original versions are denied', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const { data, error } = await clientA
        .from('voice_versions')
        .insert({
          recording_id: storageFixture.recordingId,
          effect_type: 'original',
          effect_settings: {},
          storage_path: storageFixture.path,
          duration_seconds: 1.25,
          mime_type: 'audio/wav',
          file_size_bytes: storageFixture.audio.size,
        })
        .select('id')
        .single();

      if (error?.code !== '23505' || data) {
        throw new CheckFailure('The unique-original constraint did not reject a duplicate original version.');
      }
    });

    await runTest('Repeated RPC submission does not create extra metadata rows', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const duplicateTitle = `Duplicate RPC ${randomUUID()}`;
      const duplicate = await clientA.rpc('create_original_voice_recording', {
        p_title: duplicateTitle,
        p_category: 'test',
        p_description: '',
        p_storage_path: storageFixture.path,
        p_mime_type: 'audio/wav',
        p_file_size_bytes: storageFixture.audio.size,
        p_duration_seconds: 1.25,
      });
      if (duplicate.error?.code !== '23505') {
        throw new CheckFailure('The RPC did not reject a repeated save of the same private object.');
      }

      const { data: recordings, error: recordingError } = await clientA
        .from('voice_recordings')
        .select('id')
        .eq('owner_id', userA.id)
        .eq('title', duplicateTitle);
      requireNoApiError(recordingError, 'Checking the repeated-save transaction rollback');
      if (recordings?.length) {
        throw new CheckFailure('The failed repeated RPC left a duplicate recording row.');
      }
    });

    await runTest('Metadata failure permits safe cleanup of an unreferenced upload', async () => {
      const audio = makeWavFixture();
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage.from('voice-files').upload(path, audio, {
        contentType: 'audio/wav',
        upsert: false,
      });
      requireNoApiError(upload.error, `Uploading the metadata-failure fixture at ${path}`);

      const failedMetadata = await clientA.rpc('create_original_voice_recording', {
        p_title: '   ',
        p_category: 'test',
        p_description: '',
        p_storage_path: path,
        p_mime_type: 'audio/wav',
        p_file_size_bytes: audio.size,
        p_duration_seconds: 1.25,
      });
      if (failedMetadata.error?.code !== '22023') {
        throw new CheckFailure('The RPC did not reject the invalid title as expected.');
      }

      await removeConfirmedUnreferencedAudio(clientA, path);
    });

    await runTest('RPC rejects uploaded-object MIME and size mismatches', async () => {
      const audio = makeWavFixture();
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage.from('voice-files').upload(path, audio, {
        contentType: 'audio/wav',
        upsert: false,
      });
      requireNoApiError(upload.error, `Uploading the metadata-mismatch fixture at ${path}`);

      const mismatchCases = [
        { p_mime_type: 'audio/x-wav', p_file_size_bytes: audio.size },
        { p_mime_type: 'audio/wav', p_file_size_bytes: audio.size + 1 },
      ];
      for (const mismatch of mismatchCases) {
        const result = await clientA.rpc('create_original_voice_recording', {
          p_title: `Metadata mismatch ${randomUUID()}`,
          p_category: 'test',
          p_description: '',
          p_storage_path: path,
          p_mime_type: mismatch.p_mime_type,
          p_file_size_bytes: mismatch.p_file_size_bytes,
          p_duration_seconds: 1.25,
        });
        if (result.error?.code !== '22023') {
          throw new CheckFailure('The RPC did not reject the uploaded-object MIME or size mismatch.');
        }
      }

      await removeConfirmedUnreferencedAudio(clientA, path);
    });

    await runTest('Referenced original deletion is denied', async () => {
      if (!storageFixture) return skip('The User A private original fixture was not created.');

      const removal = await clientA.storage.from('voice-files').remove([storageFixture.path]);
      if (removal.error && !isStorageDenial(removal.error)) {
        throw new CheckFailure(`Referenced-object deletion failed unexpectedly (${apiErrorCode(removal.error)}).`);
      }

      const stillAvailable = await clientA.storage
        .from('voice-files')
        .download(storageFixture.path);
      requireNoApiError(stillAvailable.error, 'Verifying a referenced original remains available');
      if (!stillAvailable.data || stillAvailable.data.size !== storageFixture.audio.size) {
        throw new CheckFailure('A referenced original was deleted.');
      }
    });

    await runTest('Owner can remove an unreferenced upload', async () => {
      const path = `${userA.id}/${randomUUID()}.wav`;
      trackStorageTestPath(path);
      const upload = await clientA.storage.from('voice-files').upload(path, makeWavFixture(), {
        contentType: 'audio/wav',
        upsert: false,
      });
      requireNoApiError(upload.error, `Uploading the unreferenced cleanup fixture at ${path}`);

      const removal = await clientA.storage.from('voice-files').remove([path]);
      requireNoApiError(removal.error, `Removing owned unreferenced audio object ${path}`);
      if (!includesStoragePath(removal.data, path)) {
        throw new CheckFailure(`Storage did not confirm removal of owned unreferenced object ${path}.`);
      }
      pendingStorageCleanupPaths.delete(path);
    });
  } finally {
    if (signedInA) {
      await signOutLocally(clientA, 'User A');
    }
    if (signedInB) {
      await signOutLocally(clientB, 'User B');
    }
  }
}

try {
  await main();
} catch {
  report('API verification runner', 'FAIL', 'Unexpected runner failure; details withheld.');
} finally {
  const completedTests = new Set(results.map((result) => result.name));
  for (const test of requiredTests) {
    if (!completedTests.has(test)) report(test, 'SKIP', 'The runner did not reach this test.');
  }
  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const skipped = results.filter((result) => result.status === 'SKIP').length;
  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped.`);
  if (results.some((result) => result.name === 'User A can use INSERT RETURNING id' && result.status === 'PASS')) {
    console.log('Note: The private recording fixture remains in the dev database; client-side DELETE is intentionally unavailable.');
  }
  if (results.some((result) => result.name === 'User A uploads and saves one private original' && result.status === 'PASS')) {
    console.log('Note: The marked private Storage API recording and object remain in echovault-dev. Run the trusted cleanup SQL for metadata, then remove only the printed path through User A authorized Storage access.');
  }
  for (const path of retainedStoragePaths) {
    console.log(`Referenced Storage cleanup path (remove only after metadata cleanup succeeds): ${path}`);
  }
  for (const path of pendingStorageCleanupPaths) {
    console.warn(`Unresolved Storage cleanup path (verify its metadata/reference state before removal): ${path}`);
  }
  if (failed > 0) process.exitCode = 1;
}
