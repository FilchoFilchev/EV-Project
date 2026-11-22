import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentProjectRef = 'zysyghbbbesatbehravb';
const expectedOwnerId = '207f9dbf-ae7e-42eb-9925-9fb371724e97';
const expectedObjectSize = 20044;
const exactPaths = [
  `${expectedOwnerId}/50b95405-ef0a-443e-8a97-ff22c54b494c.wav`,
  `${expectedOwnerId}/8442bc07-26fa-4725-9c04-76875e8ba7ce.wav`,
];
const requiredFlags = [
  '--confirm-echovault-dev',
  '--confirm-zero-global-db-references',
  '--delete-exact-prompt09-test-objects',
];
const pathStates = new Map(exactPaths.map((objectPath) => [objectPath, 'not attempted']));

class CleanupStop extends Error {}

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
    throw new CleanupStop('The configured Supabase URL is missing or invalid.');
  }

  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
    url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CleanupStop('Expected a plain HTTPS Supabase project URL.');
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

async function loadConfiguration() {
  const envFile = path.join(projectRoot, 'supabase', 'tests', '.env.rls-test.local');
  const contents = await readFile(envFile, 'utf8');
  const names = [
    'SUPABASE_TEST_URL',
    'SUPABASE_TEST_PUBLISHABLE_KEY',
    'RLS_USER_A_EMAIL',
    'RLS_USER_A_PASSWORD',
  ];
  const values = Object.fromEntries(names.map((name) => [name, parseEnvValue(contents, name)]));
  const missing = names.filter((name) => !values[name]);
  if (missing.length) {
    throw new CleanupStop(`Missing required test configuration fields: ${missing.join(', ')}.`);
  }

  if (names.some((name) => process.env[name] !== values[name])) {
    throw new CleanupStop('Runtime test configuration differs from the ignored local test environment file.');
  }

  const testUrl = parseProjectUrl(values.SUPABASE_TEST_URL);
  if (testUrl.hostname.split('.')[0] !== developmentProjectRef) {
    throw new CleanupStop('The configured URL is not the verified echovault-dev project.');
  }
  if (!isPublishableKey(values.SUPABASE_TEST_PUBLISHABLE_KEY)) {
    throw new CleanupStop('The configured key is not a publishable/anon key.');
  }

  const appEnv = await readFile(path.join(projectRoot, '.env.local'), 'utf8');
  const appUrlValue = parseEnvValue(appEnv, 'VITE_SUPABASE_URL');
  if (!appUrlValue || parseProjectUrl(appUrlValue).hostname.split('.')[0] !== developmentProjectRef) {
    throw new CleanupStop('The application environment is not configured for the verified echovault-dev project.');
  }

  return {
    url: testUrl.toString().replace(/\/$/, ''),
    key: values.SUPABASE_TEST_PUBLISHABLE_KEY,
    email: values.RLS_USER_A_EMAIL,
    password: values.RLS_USER_A_PASSWORD,
  };
}

function requireConfirmationFlags() {
  const missing = requiredFlags.filter((flag) => !process.argv.includes(flag));
  if (missing.length) {
    throw new CleanupStop(`Destructive execution requires all explicit flags: ${missing.join(', ')}.`);
  }
}

async function verifyNoVisibleReferences(client, objectPath) {
  const { data, error } = await client
    .from('voice_versions')
    .select('id,recording_id,storage_path')
    .eq('storage_path', objectPath);

  if (error) {
    throw new CleanupStop('Could not verify the authenticated database reference check; no deletion was attempted.');
  }
  if (data.length !== 0) {
    throw new CleanupStop(`A database reference remains for ${objectPath}; no deletion was attempted.`);
  }
}

async function verifyObjectExists(client, objectPath) {
  const { data, error } = await client.storage.from('voice-files').download(objectPath);
  if (error || !data) {
    throw new CleanupStop(`Could not confirm the exact Storage object before deletion: ${objectPath}.`);
  }
  if (data.size !== expectedObjectSize) {
    throw new CleanupStop(`Unexpected Storage object size for ${objectPath}; no deletion was attempted.`);
  }
  if (data.type.toLowerCase().split(';', 1)[0] !== 'audio/wav') {
    throw new CleanupStop(`Unexpected Storage object MIME type for ${objectPath}; no deletion was attempted.`);
  }
}

async function verifyObjectAbsent(client, objectPath) {
  const fileName = objectPath.split('/').at(-1);
  const { data, error } = await client.storage.from('voice-files').list(expectedOwnerId, {
    limit: 100,
    search: fileName,
  });
  if (error || !Array.isArray(data)) {
    throw new CleanupStop(`Removal was confirmed by Storage, but absence could not be rechecked for ${objectPath}.`);
  }
  if (data.some((entry) => entry.name === fileName)) {
    throw new CleanupStop(`Storage still lists ${objectPath} after the removal response.`);
  }
}

async function main() {
  requireConfirmationFlags();
  const config = await loadConfiguration();
  const client = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  let signedIn = false;
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: config.email,
      password: config.password,
    });
    if (error || !data?.user) {
      throw new CleanupStop('User A authentication failed; no deletion was attempted.');
    }
    signedIn = true;
    if (data.user.id !== expectedOwnerId) {
      throw new CleanupStop('Authenticated user is not the exact expected User A; no deletion was attempted.');
    }

    for (const objectPath of exactPaths) {
      await verifyNoVisibleReferences(client, objectPath);
    }
    for (const objectPath of exactPaths) {
      await verifyObjectExists(client, objectPath);
    }

    console.log('Preflight passed for the exact echovault-dev User A paths.');
    console.log('Global zero-reference confirmation flag supplied; authenticated RLS checks also returned no references.');

    for (const objectPath of exactPaths) {
      pathStates.set(objectPath, 'removal attempted; result not yet confirmed');
      const { data: removedObjects, error } = await client.storage
        .from('voice-files')
        .remove([objectPath]);
      if (error) {
        throw new CleanupStop(`Storage returned an error for ${objectPath}; its final state must be verified.`);
      }
      if (!Array.isArray(removedObjects) || !removedObjects.some((object) => object?.name === objectPath)) {
        throw new CleanupStop(`Storage did not confirm removal of the exact path ${objectPath}.`);
      }

      pathStates.set(objectPath, 'removal response confirmed');
      await verifyObjectAbsent(client, objectPath);
      pathStates.set(objectPath, 'confirmed removed and absent');
      console.log(`REMOVAL_CONFIRMED=${objectPath}`);
    }

    console.log('Both exact Storage objects were removed and verified absent.');
  } finally {
    if (signedIn) {
      await client.auth.signOut({ scope: 'local' });
    }
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof CleanupStop ? error.message : 'Unexpected cleanup error; details withheld.';
  console.error(`Storage cleanup stopped: ${message}`);
  for (const [objectPath, state] of pathStates) {
    console.error(`PATH_STATE=${state} PATH=${objectPath}`);
  }
  process.exitCode = 1;
}
