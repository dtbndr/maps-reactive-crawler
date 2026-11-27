import os, pty, select, subprocess, sys, time

master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
# Queue input before the child can display its prompt; the prompt flushes it.
if sys.argv[1] == 'buffered-yes-then-no':
    os.write(master, b'yes\n')
out = bytearray()
deadline = time.monotonic() + 10
sent = False
while time.monotonic() < deadline:
    readable, _, _ = select.select([master], [], [], 0.1)
    if readable:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        out.extend(data)
        if not sent and b'READY: Type yes' in out:
            os.write(master, (('no' if sys.argv[1] == 'buffered-yes-then-no' else sys.argv[1]) + '\n').encode())
            sent = True
    if child.poll() is not None and not readable:
        break
if child.poll() is None:
    child.kill()
child.wait()
os.close(master)
sys.stdout.buffer.write(out)
sys.exit(0 if child.returncode == 1 and (not sent if sys.argv[1] == 'expect-blocked' else sent) else 1)
