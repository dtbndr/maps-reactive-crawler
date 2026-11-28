import { spawn } from 'node:child_process';

// POSIX Python supplies tcflush, which Node does not expose. Isolated mode and a
// fixed executable avoid configurable command/authorization injection. Failure,
// including a missing interpreter or unsupported termios, is always denial.
const helper = String.raw`
import os, sys, termios
try:
    if not os.isatty(0) or not os.isatty(1):
        sys.exit(1)
    sys.stdout.write(sys.argv[1] + '\nConfirm the displayed seed and provider action.\nConfirm? Only yes confirms.\n')
    sys.stdout.flush()
    termios.tcflush(0, termios.TCIFLUSH)
    sys.stdout.write('READY: Type yes and press Enter: ')
    sys.stdout.flush()
    answer = sys.stdin.buffer.readline(128)
    sys.exit(0 if answer in (b'yes\n', b'yes\r\n') else 1)
except (OSError, ValueError):
    sys.exit(1)
`;

/** Internal only: the result is ephemeral and is not authorization. */
export async function terminalPrompt(preview: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.readableLength !== 0 || process.stdin.readableFlowing === true) return false;
  return await new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', ['-I', '-c', helper, preview], {
      stdio: ['inherit', 'inherit', 'ignore'],
    });
    child.once('error', () => resolve(false));
    child.once('close', (code, signal) => resolve(code === 0 && signal === null));
  });
}
