import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
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
];

class CheckFailure extends Error {}

function report(name, status, detail = '') {
  results.push({ name, status });
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function skip(reason) {
  return { skip: reason };
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
    throw new CheckFailure('Cannot verify the test URL differs from the app project: .env.local is unavailable.');
  }
  const appUrlValue = parseEnvValue(appEnv, 'VITE_SUPABASE_URL');
  if (!appUrlValue) {
    throw new CheckFailure('Cannot verify the test URL differs from the app project: VITE_SUPABASE_URL is missing.');
  }
  const appUrl = parseProjectUrl(appUrlValue);
  if (testUrl.origin === appUrl.origin) {
    throw new CheckFailure('The test URL matches the app project URL; refusing to connect.');
  }

  const projectRef = testUrl.hostname.split('.')[0];
  console.log(`Target project reference: ${projectRef}`);
  console.log('Verify that this reference belongs to echovault-dev, not the primary project.');
  console.log('This run creates a private recording that these RLS policies do not permit the client to delete.');
  if (!process.stdin.isTTY) {
    throw new CheckFailure('Interactive echovault-dev confirmation is required; no network request was made.');
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let confirmation;
  try {
    confirmation = await terminal.question('Type echovault-dev to continue: ');
  } finally {
    terminal.close();
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
  if (failed > 0) process.exitCode = 1;
}
