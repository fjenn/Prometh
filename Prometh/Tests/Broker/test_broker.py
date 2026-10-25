"""Offline authorization and SDK-shape contract tests; never calls a cloud API."""
import importlib.util, os, tempfile
from pathlib import Path
from types import SimpleNamespace
from fastapi.testclient import TestClient

os.environ['PROMETH_BROKER_DATA']=tempfile.mkdtemp(prefix='prometh-broker-test-')
p=Path(__file__).resolve().parents[2]/'Runtime'/'connector_broker.py'
spec=importlib.util.spec_from_file_location('broker',p)
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
client=TestClient(b.app)
SCHEMA={'type':'object','properties':{'subject':{'type':'string'}},'required':['subject'],'additionalProperties':False}
class Session:
    session_id='session-fake'
    calls=[]
    def search(self,**kwargs):return {'success':True,'tool_schemas':{'GMAIL_SEND':{'tool_slug':'GMAIL_SEND','toolkit':'gmail','input_schema':None},'UNTRUSTED':{'toolkit':'other','input_schema':SCHEMA}}}
    def execute(self,name,**kwargs):self.calls.append((name,kwargs));return {'success':True}
class Accounts:
    owner=None;status='ACTIVE'
    def get(self,id):
        owner=self.owner or id.split(':')[0]
        return Box(id=id,status=self.status,user_id=owner,toolkit={'slug':'gmail'})
    def delete(self,id):pass
class Box(SimpleNamespace):
    def model_dump(self,**kwargs):return vars(self)
session=Session();accounts=Accounts()
b.CLIENT=SimpleNamespace(sessions=SimpleNamespace(create=lambda **kw:session,use=lambda id:session),tools=SimpleNamespace(get_raw_composio_tool_by_slug=lambda slug:{'toolkit':{'slug':'gmail'},'input_parameters':SCHEMA}),connected_accounts=accounts)
def credentials():
    value=client.post('/install').json()
    token=client.post('/session',headers={'Authorization':'Bearer '+value['installToken']}).json()['accessToken']
    return value['installID'],{'Authorization':'Bearer '+token}
def connection(id):
    with b.LOCK:b.DB.execute('INSERT OR REPLACE INTO connections VALUES(?,?,?)',(id,'Gmail',id+':account'));b.DB.commit()
def test_invalid_and_cross_install_authorization():
    assert client.post('/tools/search',json={'query':'email'}).status_code==401
    assert client.post('/session',headers={'Authorization':'Bearer invalid.secret'}).status_code==401
    first,h=credentials();second,other=credentials();connection(first)
    assert client.post('/tools/search',headers=h,json={'query':'email'}).status_code==200
    assert client.post('/tools/execute',headers=other,json={'name':'GMAIL_SEND','arguments':{'subject':'hello'},'confirmed':True}).status_code==400
    assert client.post('/connections/status',headers=other,json={'provider':'Gmail'}).json()['status']=='DISCONNECTED'
def test_partial_schema_resolves_and_validated_execution_is_pinned():
    id,h=credentials();connection(id)
    result=client.post('/tools/search',headers=h,json={'query':'email'}).json()
    assert result['tools']['GMAIL_SEND']['input_schema']==SCHEMA
    assert 'UNTRUSTED' not in result['tools']
    payload={'name':'GMAIL_SEND','arguments':{'subject':'hello'}}
    assert client.post('/tools/execute',headers=h,json=payload).status_code==403
    assert client.post('/tools/execute',headers=h,json={**payload,'confirmed':True,'arguments':{}}).status_code==400
    assert client.post('/tools/execute',headers=h,json={**payload,'confirmed':True}).status_code==200
    assert session.calls[-1][1]['account']==id+':account'
    accounts.owner='another-install'
    try:assert client.post('/tools/execute',headers=h,json={**payload,'confirmed':True}).status_code==403
    finally:accounts.owner=None
    accounts.status='REVOKED'
    try:assert client.post('/tools/execute',headers=h,json={**payload,'confirmed':True}).status_code==409
    finally:accounts.status='ACTIVE'
    assert client.post('/connections/disconnect',headers=h,json={'provider':'Gmail'}).status_code==200
    assert client.post('/tools/execute',headers=h,json={**payload,'confirmed':True}).status_code==400

if __name__ == '__main__':
    test_invalid_and_cross_install_authorization()
    test_partial_schema_resolves_and_validated_execution_is_pinned()
    print('2 broker fixture checks passed')
