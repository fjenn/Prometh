"""Own the llama.cpp child, including cancellation and unexpected parent exit.
Process ownership follows Nativ's standalone launcher (MIT).
"""
import os, signal, subprocess, sys, time

child = None
def stop(signum=None, frame=None):
    if child and child.poll() is None:
        child.terminate()
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    if signum: sys.exit(128+signum)

for sig in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]:signal.signal(sig,stop)
parent=os.getppid()
try:
    child=subprocess.Popen(sys.argv[1:])
    while child.poll() is None:
        if os.getppid()!=parent: stop(); break
        time.sleep(.2)
    sys.exit(child.returncode or 0)
finally:stop()
