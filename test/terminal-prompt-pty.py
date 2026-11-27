import os
import pty
import select
import subprocess
import sys
import time

mode = sys.argv[1]
master, slave = pty.openpty()
if mode == 'buffered':
    os.write(master, b'yes\n')
child = subprocess.Popen(['node', '--input-type=module', '-e', "import {terminalPrompt} from './dist/terminal-prompt.js'; console.log('RESULT:' + await terminalPrompt('PREVIEW'));"], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
data = b''
end = time.monotonic() + 6

def collect_until(marker, timeout):
    global data
    deadline = time.monotonic() + timeout
    while marker not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data += os.read(master, 4096)
            except OSError:
                break

try:
    collect_until(b'READY', 5)
    assert b'PREVIEW' in data and b'Confirm?' in data and b'READY' in data, repr(data)
    if mode == 'buffered':
        collect_until(b'RESULT:', 0.3)
        assert b'RESULT:' not in data, repr(data)
    os.write(master, b'yes\n' if mode == 'yes' else b'no\n')
    collect_until(b'RESULT:', max(0, end - time.monotonic()))
    expected = b'RESULT:true' if mode == 'yes' else b'RESULT:false'
    assert expected in data, repr(data)
    assert child.wait(timeout=2) == 0
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
