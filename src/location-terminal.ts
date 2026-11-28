import { spawn } from 'node:child_process';
import type { LocationSelection } from './location-input.js';

const helper = String.raw`
import json, os, sys, termios
try:
    if not os.isatty(0) or not os.isatty(1): sys.exit(1)
    print(sys.argv[1])
    rows = json.loads(sys.argv[2])
    for index, row in enumerate(rows, 1): print(str(index) + '. ' + row)
    termios.tcflush(0, termios.TCIFLUSH)
    print('Select candidate number, or cancel: ', end='', flush=True)
    choice = sys.stdin.buffer.readline(128).strip()
    if not choice.isdigit(): sys.exit(1)
    number = int(choice)
    if number < 1 or number > len(rows): sys.exit(1)
    print('Selected candidate: ' + rows[number - 1])
    termios.tcflush(0, termios.TCIFLUSH)
    print('Confirm this candidate? Only yes confirms: ', end='', flush=True)
    answer = sys.stdin.buffer.readline(128)
    if answer not in (b'yes\n', b'yes\r\n'): sys.exit(1)
    sys.stderr.write(choice.decode('ascii'))
except (OSError, ValueError): sys.exit(1)
`;

export const selectLocationOnTerminal: LocationSelection = async (display, candidates) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.readableLength !== 0 || process.stdin.readableFlowing === true) return null;
  return await new Promise(resolve => {
    const rows = candidates.map(c => `${JSON.stringify(c.label).slice(1, -1)} | ${c.country} | ${c.latitude}, ${c.longitude}`);
    const child = spawn('/usr/bin/python3', ['-I', '-c', helper, display, JSON.stringify(rows)], {stdio: ['inherit', 'inherit', 'pipe']});
    let choice = '';
    child.stderr.on('data', chunk => { choice += String(chunk); });
    child.once('error', () => resolve(null));
    child.once('close', (code, signal) => resolve(code === 0 && signal === null && /^\d+$/.test(choice) ? Number(choice) - 1 : null));
  });
};
