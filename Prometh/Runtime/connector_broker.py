"""Optional Prometh broker. Run on an operator-controlled HTTPS server.

COMPOSIO_API_KEY exists only here, never inside the desktop bundle. Each anonymous
installation gets an opaque Keychain credential, exchanged for a 15-minute scoped
token. Provider connections and sessions are isolated by server-assigned install ID.
Local AI does not depend on this service.
"""
import base64, hashlib, hmac, json, os, secrets, sqlite3, threading, time
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException, Request as HTTPRequest
from fastapi.responses import JSONResponse
from collections import deque
from pydantic import BaseModel, ConfigDict, Field

PROVIDERS={'Gmail':'gmail','Google Drive':'googledrive','Outlook':'outlook','GitHub':'github'}
ROOT=Path(os.environ.get('PROMETH_BROKER_DATA','./broker-data')).resolve()
ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
KEY_PATH=ROOT/'session-signing-key'
if not KEY_PATH.exists():
    fd=os.open(KEY_PATH,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'wb') as f:f.write(secrets.token_bytes(32))
SIGNING_KEY=KEY_PATH.read_bytes()
DB=sqlite3.connect(ROOT/'broker.sqlite',check_same_thread=False)
DB.row_factory=sqlite3.Row
DB.executescript('''CREATE TABLE IF NOT EXISTS installs(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,session_id TEXT,session_at REAL);
CREATE TABLE IF NOT EXISTS connections(install_id TEXT,provider TEXT,account_id TEXT,PRIMARY KEY(install_id,provider));''')
DB.commit();LOCK=threading.RLock();CLIENT=None;SCHEMAS={}
app=FastAPI(title='Prometh optional connection broker',docs_url=None,redoc_url=None)
RATE_WINDOWS={}
@app.middleware('http')
async def bound_requests(request:HTTPRequest,call_next):
    # Single-process broker safeguard. A public deployment also needs a reverse
    # proxy request/body cap and a persistent distributed quota for multiple workers.
    address=request.client.host if request.client else 'unknown'
    identity=hashlib.sha256(request.headers.get('authorization','').encode()).hexdigest()
    key=(address, 'install' if request.url.path=='/install' else identity)
    limit=10 if request.url.path=='/install' else 120
    now=time.monotonic()
    with LOCK:
        if len(RATE_WINDOWS)>10000:
            for old in list(RATE_WINDOWS):
                if not RATE_WINDOWS[old] or RATE_WINDOWS[old][-1]<now-60:RATE_WINDOWS.pop(old,None)
        window=RATE_WINDOWS.setdefault(key,deque())
        while window and window[0]<now-60:window.popleft()
        if len(window)>=limit:return JSONResponse({'detail':'Too many requests; retry shortly'},status_code=429)
        window.append(now)
    try:
        if int(request.headers.get('content-length','0'))>65536:return JSONResponse({'detail':'Request too large'},status_code=413)
    except ValueError:return JSONResponse({'detail':'Invalid content length'},status_code=400)
    return await call_next(request)


class Request(BaseModel):
    model_config=ConfigDict(extra='forbid')
class ProviderRequest(Request):provider:str
class SearchRequest(Request):query:str=Field(min_length=1,max_length=300)
class ExecuteRequest(Request):name:str=Field(min_length=1,max_length=150);arguments:dict;confirmed:bool=False

def composio():
    global CLIENT
    if CLIENT is None:
        if not os.environ.get('COMPOSIO_API_KEY'):raise HTTPException(503,'Operator must configure COMPOSIO_API_KEY on the broker. Local AI is unaffected.')
        from composio import Composio
        CLIENT=Composio(api_key=os.environ['COMPOSIO_API_KEY'])
    return CLIENT

def jsonable(value):
    if hasattr(value,'model_dump'):return value.model_dump(mode='json')
    if isinstance(value,dict):return {k:jsonable(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [jsonable(v) for v in value]
    return value

def b64(data):return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
def bearer(header):
    if not header or not header.startswith('Bearer '):raise HTTPException(401,'Missing installation authorization')
    return header[7:]
def access(header):
    raw=bearer(header)
    try:
        payload,signature=raw.split('.')
        if not hmac.compare_digest(signature,b64(hmac.digest(SIGNING_KEY,payload.encode(),'sha256'))):raise ValueError()
        claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        if claims['exp']<time.time() or claims['scope']!='prometh-connectors':raise ValueError()
        with LOCK:row=DB.execute('SELECT id FROM installs WHERE id=?',(claims['sub'],)).fetchone()
        if not row:raise ValueError()
        return row['id']
    except Exception:raise HTTPException(401,'Session expired; obtain another scoped token')

def session(install_id):
    client=composio()
    with LOCK:
        row=DB.execute('SELECT * FROM installs WHERE id=?',(install_id,)).fetchone()
        if row['session_id'] and (row['session_at'] or 0)>time.time()-3600:
            return client.sessions.use(row['session_id'])
        current=client.sessions.create(user_id=install_id,toolkits=list(PROVIDERS.values()),manage_connections=False)
        DB.execute('UPDATE installs SET session_id=?,session_at=? WHERE id=?',(current.session_id,time.time(),install_id));DB.commit()
        return current

def toolkit(provider):
    if provider not in PROVIDERS:raise HTTPException(400,'Unsupported provider')
    return PROVIDERS[provider]

def account(install_id,provider):
    with LOCK:row=DB.execute('SELECT account_id FROM connections WHERE install_id=? AND provider=?',(install_id,provider)).fetchone()
    if not row:return None
    result=composio().connected_accounts.get(row['account_id'])
    raw=jsonable(result)
    # The server remembers the auth attempt. Callback query data is never trusted.
    owner=raw.get('user_id') or raw.get('userId')
    slug=(raw.get('toolkit') or {}).get('slug')
    if (owner is not None and owner != install_id) or slug != toolkit(provider):raise HTTPException(403,'Connected account ownership mismatch')
    return result

@app.get('/health')
def health():return {'status':'ok','configured':bool(os.environ.get('COMPOSIO_API_KEY'))}

@app.post('/install')
def install():
    install_id='prometh_'+secrets.token_urlsafe(24);credential=secrets.token_urlsafe(48)
    with LOCK:DB.execute('INSERT INTO installs(id,secret_hash) VALUES(?,?)',(install_id,hashlib.sha256(credential.encode()).hexdigest()));DB.commit()
    return {'installID':install_id,'installToken':install_id+'.'+credential}

@app.post('/session')
def short_session(authorization:str|None=Header(None)):
    raw=bearer(authorization)
    try:install_id,credential=raw.split('.',1)
    except ValueError:raise HTTPException(401,'Invalid installation credential')
    with LOCK:row=DB.execute('SELECT secret_hash FROM installs WHERE id=?',(install_id,)).fetchone()
    if not row or not hmac.compare_digest(row['secret_hash'],hashlib.sha256(credential.encode()).hexdigest()):raise HTTPException(401,'Invalid installation credential')
    expiry=int(time.time())+900
    payload=b64(json.dumps({'sub':install_id,'exp':expiry,'scope':'prometh-connectors'},separators=(',',':')).encode())
    return {'accessToken':payload+'.'+b64(hmac.digest(SIGNING_KEY,payload.encode(),'sha256')),'expiresAt':expiry}

@app.post('/connections/authorize')
def authorize(body:ProviderRequest,authorization:str|None=Header(None)):
    install_id=access(authorization)
    request=session(install_id).authorize(toolkit(body.provider),callback_url=os.environ.get('PROMETH_BROKER_CALLBACK_URL'))
    with LOCK:DB.execute('INSERT OR REPLACE INTO connections VALUES(?,?,?)',(install_id,body.provider,request.id));DB.commit()
    return {'redirectURL':request.redirect_url,'status':request.status}

@app.post('/connections/status')
def status(body:ProviderRequest,authorization:str|None=Header(None)):
    install_id=access(authorization);toolkit(body.provider)
    value=account(install_id,body.provider)
    return {'status':str(value.status) if value else 'DISCONNECTED'}

@app.post('/connections/disconnect')
def disconnect(body:ProviderRequest,authorization:str|None=Header(None)):
    install_id=access(authorization);value=account(install_id,body.provider)
    if value:composio().connected_accounts.delete(value.id)
    with LOCK:DB.execute('DELETE FROM connections WHERE install_id=? AND provider=?',(install_id,body.provider));DB.commit()
    with LOCK:
        for key in list(SCHEMAS):
            if key[0] == install_id:SCHEMAS.pop(key,None)
        DB.execute('UPDATE installs SET session_id=NULL,session_at=NULL WHERE id=?',(install_id,));DB.commit()
    return {'status':'DISCONNECTED'}

@app.post('/tools/search')
def search(body:SearchRequest,authorization:str|None=Header(None)):
    install_id=access(authorization)
    result=session(install_id).search(query=body.query)
    raw=jsonable(result)
    schemas=raw.get('tool_schemas',{})
    safe={}
    for slug,value in schemas.items():
        if value.get('toolkit') not in PROVIDERS.values():continue
        schema=value.get('input_schema')
        if not schema:
            # Search can return abbreviated schemas. Resolve the official tool
            # rather than caching an unexecutable schema-reference placeholder.
            full=jsonable(composio().tools.get_raw_composio_tool_by_slug(slug))
            if (full.get('toolkit') or {}).get('slug') != value['toolkit']:continue
            schema=full.get('input_parameters')
        if not isinstance(schema,dict):continue
        from jsonschema.validators import validator_for
        validator_for(schema).check_schema(schema)
        with LOCK:SCHEMAS[(install_id,slug)]={'schema':schema,'toolkit':value['toolkit'],'expires':time.time()+900}
        safe[slug]={'tool_slug':slug,'toolkit':value['toolkit'],'description':value.get('description'),'input_schema':schema}
    return {'success':raw.get('success',True),'tools':safe,'results':raw.get('results',[])}

@app.post('/tools/execute')
def execute(body:ExecuteRequest,authorization:str|None=Header(None)):
    install_id=access(authorization)
    if not body.confirmed:raise HTTPException(403,'Desktop confirmation is required before connected-app execution')
    with LOCK:discovered=SCHEMAS.get((install_id,body.name))
    if not discovered or discovered['expires']<time.time():raise HTTPException(400,'Discover this tool with its full schema before executing it')
    from jsonschema import validate, ValidationError
    try:validate(body.arguments,discovered['schema'])
    except ValidationError as error:raise HTTPException(400,'Tool arguments do not match schema: '+error.message)
    # Session belongs to this server-issued installation. SDK validates the tool
    # schema and resolves only its connected accounts; arbitrary user IDs are absent.
    provider=next((name for name,slug in PROVIDERS.items() if slug==discovered['toolkit']),None)
    connected=account(install_id,provider) if provider else None
    if not connected or str(connected.status) != 'ACTIVE':raise HTTPException(409,'Reconnect this application before executing a tool')
    result=session(install_id).execute(body.name,arguments=body.arguments,account=connected.id)
    raw=jsonable(result)
    return raw if isinstance(raw,dict) else {'result':raw}
