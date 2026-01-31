#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { table } from 'table';
import enquirer from 'enquirer';
import api from './api';
import config, { getActiveBin, setActiveBin } from './config';
import pc from 'picocolors';

process.on('unhandledRejection', (reason) => {
  // Enquirer throws an empty string/nothing when interrupted with Ctrl+C
  if (reason === '' || (reason as any)?.name === 'Error') {
    process.exit(0);
  }
  process.exit(1);
});

const requireBin = (binId?: string) => {
  const active = binId || getActiveBin();
  if (!active) {
    console.error(pc.red('✖ No bin specified and no active bin set.'));
    console.log(`\nRun:\n  ${pc.cyan('curlme bin use <binId>')}\n  ${pc.cyan('curlme listen <binId>')}\n`);
    process.exit(1);
  }
  return active;
};

const formatShortId = (id: string) => `rq_${id.substring(0, 6)}`;

const formatRequest = (r: any) => {
  const displayId = formatShortId(r.id);
  console.log(`\n${pc.bold('Request')} ${pc.yellow(displayId)}`);
  console.log(DIVIDER);
  console.log(`${pc.bold('Method')}    ${pc.yellow(r.method)}`);
  console.log(`${pc.bold('Path')}      ${pc.dim(r.path)}`);
  console.log(`${pc.bold('Source')}    ${pc.dim(r.ip || 'unknown')}`);
  console.log(`${pc.bold('Size')}      ${pc.dim(r.size + 'B')}`);
  
  console.log(`\n${pc.bold('Headers')}`);
  Object.entries(r.headers).forEach(([key, val]) => {
    console.log(`  ${pc.dim(key.padEnd(12))} ${val}`);
  });

  if (r.body) {
    console.log(`\n${pc.bold('Body')}`);
    try {
      const parsed = JSON.parse(r.body as string);
      console.log(JSON.stringify(parsed, null, 2).split('\n').map(l => `  ${pc.dim(l)}`).join('\n'));
    } catch {
      console.log(`  ${pc.dim(r.body)}`);
    }
  }
  console.log('');
};

const program = new Command();

const DIVIDER = pc.dim('────────────────────────────────────────');

program
  .name('curlme')
  .description('Terminal-first request debugging')
  .version('1.0.0')
  .showHelpAfterError(true)
  .configureHelp({
    subcommandTerm: (cmd) => {
      const aliases = cmd.aliases();
      return pc.yellow(cmd.name() + (aliases.length ? `, ${aliases.join(', ')}` : ''));
    },
    commandUsage: (cmd) => pc.dim('curlme ') + pc.yellow('<command> ') + pc.dim('[options]'),
  });

program.helpInformation = function() {
  const activeBin = getActiveBin();
  return `
${pc.bold('curlme')} ${pc.dim('— terminal-first request debugging')}
${DIVIDER}

Capture, inspect, replay and diff HTTP requests
directly from your terminal.

${pc.bold('USAGE')}
  ${pc.dim('curlme')} ${pc.yellow('<command>')} ${pc.dim('[options]')}

${pc.bold('CORE WORKFLOWS')}
  ${pc.yellow('listen, tail')}        Listen for incoming requests
  ${pc.yellow('latest, l')}           Show the latest request
  ${pc.yellow('show, s')}             Inspect a request
  ${pc.yellow('replay, r')}           Replay a request
  ${pc.yellow('diff, d')}             Diff two requests

${pc.bold('BIN MANAGEMENT')}
  ${pc.yellow('bin')}                 Create and manage bins
  ${pc.yellow('export')}              Export request data
  ${pc.yellow('open')}                Open bin in dashboard

${pc.bold('ACCOUNT')}
  ${pc.yellow('auth')}                Login and API keys

${pc.bold('OPTIONS')}
  ${pc.yellow('-V, --version')}       Show version
  ${pc.yellow('-h, --help')}          Show help

${pc.bold('GET STARTED')}
  ${pc.dim('1.')} ${pc.cyan('curlme bin create')}
  ${pc.dim('2.')} ${pc.cyan('curlme listen')}

${activeBin ? `\n${pc.dim('Active Bin:')} ${pc.yellow(activeBin)}` : ''}
`;
};

// --- AUTH GROUP ---
const auth = program.command('auth').description('Manage your account and authentication');

auth
  .command('login')
  .description('Login to curlme.io with your API key')
  .action(async () => {
    try {
      console.log(`\n${pc.bold('Authenticate')} ${pc.dim('— generate key at ' + api.getBaseUrl() + '/account')}`);
      console.log(DIVIDER);
      
      const response = await enquirer.prompt<{ apiKey: string }>({
        type: 'input',
        name: 'apiKey',
        message: 'Enter API Key:'
      });

      if (response.apiKey) {
        config.set('apiKey', response.apiKey);
        const spinner = ora(pc.dim(`Verifying…`)).start();
        try {
          const user = await api.getWhoAmI();
          spinner.stop();
          console.log(`\n${pc.yellow('✔')} ${pc.bold('Authenticated')} as ${pc.yellow(user.email)}`);
          console.log(DIVIDER + '\n');
        } catch (error: any) {
          spinner.fail(pc.red(`Not authenticated`));
          console.log(`\nRun: ${pc.cyan('curlme auth login')}\n`);
          config.delete('apiKey');
        }
      }
    } catch (e) {
      return;
    }
  });

auth
  .command('whoami')
  .description('Display the current logged in user')
  .action(async () => {
    try {
      const user = await api.getWhoAmI();
      console.log(`\n${pc.yellow('✔')} Logged in as ${pc.yellow(user.name)} ${pc.dim(`(${user.email})`)}\n`);
    } catch (error: any) {
      console.error(pc.red('\n✖ Not authenticated'));
      console.log(`Run: ${pc.cyan('curlme auth login')}\n`);
    }
  });

auth
  .command('logout')
  .description('Log out and remove stored API key')
  .action(() => {
    config.delete('apiKey');
    console.log(pc.green('✔ Logged out successfully.'));
  });

// --- BIN GROUP ---
const bin = program.command('bin').description('Manage your bins');

bin
  .command('list')
  .alias('ls')
  .description('List all your bins')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    const spinner = !options.json ? ora(pc.dim('Fetching…')).start() : null;
    try {
      const data = await api.getBins();
      const activeBin = getActiveBin();
      if (spinner) spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.length === 0) {
        console.log(pc.yellow('\nNo bins found. Create one with `curlme bin create`'));
        return;
      }

      console.log(`\n${pc.bold('Your Bins')}`);
      console.log(DIVIDER);

      const tableData = [
        ['', pc.bold('ID'), pc.bold('NAME'), pc.bold('REQS')]
      ];

      data.forEach((b: any) => {
        tableData.push([
          b.publicId === activeBin ? pc.yellow('✔') : '',
          pc.yellow(b.publicId),
          b.name,
          pc.dim((b.requestCount !== undefined ? b.requestCount : b._count?.requests) || 0)
        ]);
      });

      console.log(table(tableData, {
        border: require('table').getBorderCharacters('void'),
        columnDefault: { paddingLeft: 0, paddingRight: 2 },
        drawHorizontalLine: () => false
      }));
    } catch (error: any) {
      if (spinner) spinner.fail(pc.red(`Failed to list bins: ${error.message}`));
      else console.error(pc.red(`Error: ${error.message}`));
    }
  });

bin
  .command('use <id>')
  .description('Set the active bin')
  .action(async (id) => {
    try {
      // Verify bin exists
      const b = await api.getBin(id);
      setActiveBin(b.publicId);
      console.log(`\n${pc.yellow('✔')} Active bin set to ${pc.yellow(b.publicId)}\n`);
    } catch (error) {
      console.error(pc.red(`\n✖ Bin not found: ${id}\n`));
    }
  });

bin
  .command('create [name]')
  .description('Create a new bin')
  .action(async (name) => {
    const binName = name || `bin-${Math.random().toString(36).substring(2, 8)}`;
    const spinner = ora(pc.dim('Creating…')).start();
    try {
      const b = await api.createBin(binName);
      setActiveBin(b.publicId);
      spinner.stop();
      
      console.log(`\n${pc.yellow('✔')} ${pc.bold('Bin created')}\n`);
      console.log(`  ${pc.dim('ID')}        ${pc.yellow(b.publicId)}`);
      console.log(`  ${pc.dim('Hook')}      ${pc.dim(api.getBaseUrl() + '/api/hook/')}${pc.yellow(b.publicId)}`);
      console.log(`  ${pc.dim('Inspect')}   ${pc.cyan('curlme listen')}\n`);
      console.log(DIVIDER + '\n');
    } catch (error: any) {
      spinner.fail(pc.red(`Failed to create bin: ${error.message}`));
    }
  });

bin
  .command('info <id>')
  .description('Show detailed info about a bin')
  .action(async (id) => {
    const binId = id === 'active' ? getActiveBin() : id;
    if (!binId) {
      console.error(pc.red('✖ No active bin set.'));
      return;
    }
    const spinner = ora(pc.dim('Fetching bin info...')).start();
    try {
      const b = await api.getBin(binId);
      spinner.stop();
      console.log(`\n${pc.bold('Bin Info')} ${b.publicId === getActiveBin() ? pc.dim('(active)') : ''}`);
      console.log(pc.dim('──────────'));
      console.log(`${pc.bold('Name:')}      ${b.name}`);
      console.log(`${pc.bold('Bin:')}       ${b.publicId}`);
      console.log(`${pc.bold('Hooks:')}     ${(b.requestCount !== undefined ? b.requestCount : b._count?.requests) || 0} received`);
      console.log(`${pc.bold('URL:')}       ${api.getBaseUrl()}/bin/${b.publicId}`);
      console.log(`${pc.bold('Endpoint:')}  ${api.getBaseUrl()}/api/hook/${b.publicId}`);
      console.log('');
    } catch (error: any) {
      spinner.fail(pc.red(`Bin not found: ${id}`));
    }
  });

bin
  .command('delete <id>')
  .description('Delete a bin')
  .action(async (id) => {
    try {
      const confirm = await enquirer.prompt<{ confirmed: boolean }>({
        type: 'confirm',
        name: 'confirmed',
        message: `Are you sure you want to delete bin ${id}?`
      });

      if (!confirm.confirmed) return;

      const spinner = ora(pc.dim(`Deleting bin...`)).start();
      try {
        await api.deleteBin(id);
        if (id === getActiveBin()) {
          config.delete('activeBinId');
        }
        spinner.succeed(pc.green(`Bin deleted`));
      } catch (error: any) {
        spinner.fail(pc.red(`Failed: ${error.message}`));
      }
    } catch (e) {
      return;
    }
  });

// --- TOP LEVEL COMMANDS ---
program
  .command('listen [binId]')
  .alias('tail')
  .description('Listen for incoming requests in real-time')
  .option('--method <method>', 'Filter by HTTP method')
  .action(async (binId, options) => {
    const id = binId || getActiveBin();
    if (!id) {
      console.error(pc.red('\n✖ No bin specified and no active bin set.'));
      console.log(`Run: ${pc.cyan('curlme bin use <binId>')}\n`);
      return;
    }
    setActiveBin(id);

    console.log(`\n${pc.yellow('→')} Listening on ${pc.bold(id)} ${pc.dim('(active)')}`);
    console.log(`  ${pc.dim('Waiting for requests…')}\n`);

    let lastTimestamp = Date.now();
    
    const poll = async () => {
      try {
        const requests = await api.getRequests(id, lastTimestamp);
        if (requests.length > 0) {
          requests.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          
          requests.forEach((req: any) => {
            if (options.method && req.method.toUpperCase() !== options.method.toUpperCase()) return;

            const shortId = formatShortId(req.id);
            const methodColor = req.method === 'GET' ? pc.green : pc.yellow;
            console.log(`${pc.dim(`→`)} ${pc.bold(methodColor(req.method.padEnd(6)))} ${pc.dim(req.path.padEnd(25))} ${pc.green('200')} ${pc.dim(req.size.toString().padStart(4) + 'B')}  ${pc.yellow(shortId)}`);
            
            lastTimestamp = Math.max(lastTimestamp, new Date(req.timestamp).getTime() + 1);
          });
        }
      } catch (error: any) {
        // Quietly retry on polling errors
      }
      setTimeout(poll, 1500);
    };

    poll();
  });

program
  .command('latest [binId]')
  .alias('l')
  .description('Show the latest request')
  .action(async (binId) => {
    const id = requireBin(binId);
    const spinner = ora(pc.dim('Fetching latest request...')).start();
    try {
      const reqs = await api.getRequests(id);
      spinner.stop();

      if (reqs.length === 0) {
        console.log(pc.yellow('No requests found for this bin.'));
        return;
      }
      formatRequest(reqs[0]);
    } catch (error: any) {
      spinner.fail(pc.red(`Error: ${error.message}`));
    }
  });

program
  .command('show <requestId> [binId]')
  .alias('s')
  .description('Inspect a specific request')
  .action(async (requestId, binId) => {
    const id = requireBin(binId);
    const spinner = ora(pc.dim('Fetching request...')).start();
    try {
      const reqs = await api.getRequests(id);
      const r = reqs.find((x: any) => x.id === requestId || x.id.startsWith(requestId) || formatShortId(x.id) === requestId);
      spinner.stop();

      if (!r) {
        console.log(pc.red('✖ Request not found.'));
        return;
      }
      formatRequest(r);
    } catch (error: any) {
      spinner.fail(pc.red(`Error: ${error.message}`));
    }
  });

program
  .command('replay [requestId] [binId]')
  .alias('r')
  .description('Replay a request')
  .option('--to <url>', 'Local target URL', 'http://localhost:3000')
  .action(async (requestId, binId, options) => {
    const id = requireBin(binId);
    const spinner = ora(pc.dim('Fetching request to replay...')).start();
    try {
      const reqs = await api.getRequests(id);
      const r = (!requestId || requestId === 'latest') 
        ? reqs[0] 
        : reqs.find((x: any) => x.id === requestId || x.id.startsWith(requestId) || formatShortId(x.id) === requestId);
      
      if (spinner) spinner.stop();

      if (!r) {
        console.log(pc.red('✖ Request not found.'));
        return;
      }

      const axios = require('axios');
      const targetUrl = new URL(r.path, options.to).toString();
      const replayedSpinner = ora(pc.dim(`Replaying ${pc.bold(r.method)} to ${targetUrl}...`)).start();
      
      const start = Date.now();
      try {
        const response = await axios({
          method: r.method,
          url: targetUrl,
          headers: { ...r.headers, 'x-replayed-by': 'curlme' },
          data: r.body,
          validateStatus: () => true
        });
        const duration = Date.now() - start;
        
        replayedSpinner.stop();
        
        console.log(`\n${pc.yellow('✔')} ${pc.bold('Replayed')} ${formatShortId(r.id)}`);
        console.log(DIVIDER);
        console.log(`${pc.bold('Target')}    ${pc.dim(targetUrl)}`);
        console.log(`${pc.bold('Status')}    ${pc.yellow(response.status)}`);
        console.log(`${pc.bold('Duration')}  ${pc.dim(duration + 'ms')}\n`);
      } catch (err: any) {
        replayedSpinner.fail(pc.red(`Failed: ${err.message}`));
      }
    } catch (error: any) {
      if (spinner) spinner.fail(pc.red(`Error: ${error.message}`));
    }
  });

program
  .command('diff [id1] [id2] [binId]')
  .alias('d')
  .description('Show differences between two requests')
  .action(async (id1, id2, binId) => {
    // Determine which argument is the binId if provided
    let actualBinId = binId;
    let rid1 = id1 || 'latest';
    let rid2 = id2 || 'prev';

    const id = requireBin(actualBinId);
    const spinner = ora(pc.dim('Fetching requests...')).start();
    try {
      const reqs = await api.getRequests(id);
      const getReq = (rid: string, index: number) => {
        if (rid === 'latest') return reqs[0];
        if (rid === 'prev') return reqs[1];
        return reqs.find((x: any) => x.id === rid || x.id.startsWith(rid) || formatShortId(x.id) === rid);
      };

      const r1 = getReq(rid1, 0);
      const r2 = getReq(rid2, 1);
      spinner.stop();

      if (!r1 || !r2) {
        console.log(pc.red('\n✖ One or both requests not found.'));
        return;
      }

      console.log(`\n${pc.bold('Diffing')} ${pc.yellow(formatShortId(r1.id))} ${pc.dim('vs')} ${pc.yellow(formatShortId(r2.id))}`);
      console.log(DIVIDER);

      if (r1.body !== r2.body) {
        console.log(`${pc.bold('Body')}\n`);
        console.log(`  ${pc.red('-')} [Request 1 Body]`);
        console.log(`  ${pc.green('+')} [Request 2 Body]`);
      } else {
        console.log(`${pc.dim('Bodies are identical.')}`);
      }
      console.log('');
    } catch (error: any) {
      spinner.stop();
      console.error(pc.red(`✖ Error: ${error.message}`));
    }
  });

program
  .command('open [binId]')
  .description('Open the dashboard for a bin')
  .action(async (binId) => {
    const id = requireBin(binId);
    const open = require('open');
    const url = `${api.getBaseUrl()}/bin/${id}`;
    console.log(`${pc.green('✔')} Opening ${pc.cyan(url)}`);
    await open(url);
  });

// --- EXPORT COMMAND ---
program
  .command('export [binId]')
  .description('Export requests from a bin')
  .option('--format <format>', 'Export format (json, curl)', 'json')
  .action(async (binId, options) => {
    const id = requireBin(binId);
    const spinner = ora(pc.dim(`Exporting bin ${id}...`)).start();
    try {
      const data = await api.getExport(id, options.format);
      spinner.succeed(pc.green('Export complete'));
      console.log(JSON.stringify(data, null, 2));
    } catch (error: any) {
      spinner.fail(pc.red(`Export failed: ${error.message}`));
    }
  });

program.parse(process.argv);
