#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
TEST_APP="$(mktemp -d /tmp/prometh-voice-tests.XXXXXX)/SpeechTests.app"
trap 'rm -rf "${TEST_APP:h}"' EXIT
mkdir -p "$TEST_APP/Contents/MacOS" "$TEST_APP/Contents/Resources/Runtime/python/bin" .build/module-cache
cat > "$TEST_APP/Contents/Resources/Runtime/python/bin/python3" <<'PY'
#!/bin/zsh
unset PYTHONHOME PYTHONPATH
exec /usr/bin/python3 -u "${0:A:h}/fixture.py"
PY
cat > "$TEST_APP/Contents/Resources/Runtime/python/bin/fixture.py" <<'PY'
import json, os, sys, time
for line in sys.stdin:
    job=json.loads(line)
    request=job['requestID']
    prompt=job.get('prompt','')
    if prompt=='slow': time.sleep(2)
    if prompt=='fail': event={'event':'error','error':'fixture failure'}
    else: event={'event':'result','result':'fixture.wav','pid':os.getpid(),'prompt':prompt}
    print(json.dumps(dict(event,requestID=request)),flush=True)
    print(json.dumps(dict(event='requestDone',requestID=request)),flush=True)
PY
chmod +x "$TEST_APP/Contents/Resources/Runtime/python/bin/python3"
swiftc -disable-sandbox -swift-version 5 -module-cache-path .build/module-cache $(rg --files Sources -g '*.swift' | rg -v '/(PromethApp|Onboarding|Workspace|Settings|MediaViews|Design|ComposerEditor)\.swift$' | sort) Tests/VoiceTests.swift -o "$TEST_APP/Contents/MacOS/SpeechTests"
"$TEST_APP/Contents/MacOS/SpeechTests"
