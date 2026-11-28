import os, pty, select, subprocess, sys, time

mode = sys.argv[1]
master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
out = bytearray()
sent_choice = False
sent_confirmation = False
deadline = time.monotonic() + 10
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
        if not sent_choice and b'Select candidate number, or cancel: ' in out:
            os.write(master, {'single': b'1\n', 'multiple': b'2\n', 'invalid': b'3\n', 'cancel': b'cancel\n', 'decline': b'1\n'}[mode])
            sent_choice = True
        if not sent_confirmation and b'Only yes confirms: ' in out:
            os.write(master, b'no\n' if mode == 'decline' else b'yes\n')
            sent_confirmation = True
    if child.poll() is not None and not readable:
        break
if child.poll() is None:
    child.kill()
child.wait()
os.close(master)
sys.stdout.buffer.write(out)
sys.exit(child.returncode if child.returncode >= 0 else 1)
