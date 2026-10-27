BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();
-- Trusted fixtures: confirmation is Auth state, never raw user metadata.
INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data) VALUES
 ('31000000-0000-0000-0000-000000000001','rls-owner@example.test',now(),'{"display_name":"Owner"}'),
 ('31000000-0000-0000-0000-000000000002','rls-editor@example.test',now(),'{"display_name":"Editor"}'),
 ('31000000-0000-0000-0000-000000000003','rls-viewer@example.test',now(),'{"display_name":"Viewer"}'),
 ('31000000-0000-0000-0000-000000000004','rls-other@example.test',now(),'{"display_name":"Other"}'),
 ('31000000-0000-0000-0000-000000000005','rls-unverified@example.test',null,'{"display_name":"Unverified","verified":true}');
SELECT is((SELECT verified FROM profiles WHERE id='31000000-0000-0000-0000-000000000005'),false,'metadata cannot verify an account');
INSERT INTO documents(id,owner_id,title,content) VALUES
 ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','Protected','original'),
 ('32000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000004','Other','foreign');
INSERT INTO document_history(id,document_id,title,content,updated_by) VALUES
 ('33000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','Original','original','31000000-0000-0000-0000-000000000001'),
 ('33000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000002','Foreign','foreign','31000000-0000-0000-0000-000000000004');
INSERT INTO document_shares(document_id,user_id,permission) VALUES
 ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002','edit'),
 ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000003','view');
INSERT INTO document_attachments(document_id,uploaded_by,filename,mime_type,size_bytes,url) VALUES
 ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','a.txt','text/plain',1,'/placeholder');
INSERT INTO document_presence(document_id,user_id) VALUES
 ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM documents$$,'42501',NULL,'anonymous document reads denied');
SELECT throws_ok($$SELECT create_document('anonymous','')$$,'42501',NULL,'anonymous create RPC denied');
SELECT throws_ok($$SELECT resolve_share_recipient('32000000-0000-0000-0000-000000000001','rls-owner@example.test')$$,'42501',NULL,'anonymous email lookup denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000003',true);
SELECT is((SELECT count(*)::int FROM documents),1,'viewer reads only shared documents');
SELECT is((SELECT count(*)::int FROM document_history),1,'viewer reads shared history');
SELECT is((SELECT count(*)::int FROM document_attachments),1,'viewer reads shared attachments');
SELECT is((SELECT count(*)::int FROM document_presence),1,'viewer reads shared presence');
SELECT throws_ok($$SELECT update_document('32000000-0000-0000-0000-000000000001','tampered')$$,'42501',NULL,'viewer cannot edit through RPC');
SELECT throws_ok($$UPDATE documents SET content='tampered'$$,'42501',NULL,'viewer cannot update through SQL');
SELECT throws_ok($$SELECT restore_document('32000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001')$$,'42501',NULL,'viewer cannot restore');
SELECT throws_ok($$INSERT INTO document_attachments(document_id,uploaded_by,filename,mime_type,size_bytes,url) VALUES ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000003','a','text/plain',1,'/a')$$,'42501',NULL,'viewer cannot upload');
SELECT lives_ok($$INSERT INTO document_presence(document_id,user_id) VALUES ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000003')$$,'viewer owns presence');
SELECT throws_ok($$UPDATE document_presence SET user_id='31000000-0000-0000-0000-000000000001'$$,'42501',NULL,'presence identity immutable');
SELECT throws_ok($$UPDATE document_presence SET document_id='32000000-0000-0000-0000-000000000002'$$,'42501',NULL,'presence cannot move between documents');
WITH removed AS (DELETE FROM documents RETURNING id) SELECT is(count(*)::int,0,'viewer cannot delete') FROM removed;
SELECT throws_ok($$SELECT resolve_share_recipient('32000000-0000-0000-0000-000000000001','rls-other@example.test')$$,'42501',NULL,'viewer cannot look up email');
SELECT throws_ok($$SELECT grant_document_share('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000004','edit')$$,'42501',NULL,'viewer cannot share');
SELECT throws_ok($$UPDATE profiles SET verified=true$$,'42501',NULL,'verification field protected');
SELECT throws_ok($$SELECT email FROM profiles$$,'42501',NULL,'email directory inaccessible');
SELECT is((SELECT count(*)::int FROM profiles),3,'profile visibility only shared document collaborators');
WITH changed AS (UPDATE profiles SET display_name='Impersonated' WHERE id='31000000-0000-0000-0000-000000000001' RETURNING id) SELECT is(count(*)::int,0,'cannot change another visible profile') FROM changed;
SELECT lives_ok($$UPDATE profiles SET display_name='Updated viewer' WHERE id=auth.uid()$$,'self display name can change');

SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000004',true);
SELECT is((SELECT count(*)::int FROM document_history WHERE document_id='32000000-0000-0000-0000-000000000001'),0,'unrelated cannot read history');
SELECT is((SELECT count(*)::int FROM document_shares),0,'unrelated cannot read shares');
SELECT is((SELECT count(*)::int FROM document_attachments),0,'unrelated cannot read attachments');
SELECT is((SELECT count(*)::int FROM document_presence),0,'unrelated cannot read presence');
SELECT throws_ok($$INSERT INTO document_presence(document_id,user_id) VALUES ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000004')$$,'42501',NULL,'unrelated cannot join presence');

SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000002',true);
SELECT lives_ok($$SELECT update_document('32000000-0000-0000-0000-000000000001',NULL,'edited',true)$$,'editor saves');
SELECT is((SELECT count(*)::int FROM document_history WHERE content='edited' AND updated_by=auth.uid()),1,'history saves atomically with authenticated author');
SELECT lives_ok($$SELECT restore_document('32000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001')$$,'editor restores own document history');
SELECT throws_ok($$SELECT restore_document('32000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002')$$,'42501',NULL,'foreign history cannot be transplanted');
SELECT throws_ok($$UPDATE document_history SET content='forged'$$,'42501',NULL,'history cannot be rewritten');
SELECT throws_ok($$DELETE FROM document_history$$,'42501',NULL,'history cannot be deleted directly');
SELECT throws_ok($$INSERT INTO document_history(document_id,title,content) VALUES ('32000000-0000-0000-0000-000000000001','fake','fake')$$,'42501',NULL,'direct history forgery forbidden');
SELECT lives_ok($$INSERT INTO document_attachments(document_id,uploaded_by,filename,mime_type,size_bytes,url) VALUES ('32000000-0000-0000-0000-000000000001',auth.uid(),'editor.txt','text/plain',1,'/a')$$,'editor uploads');
SELECT throws_ok($$INSERT INTO document_attachments(document_id,uploaded_by,filename,mime_type,size_bytes,url) VALUES ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','forged.txt','text/plain',1,'/a')$$,'42501',NULL,'uploader cannot be forged');

SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000001',true);
SELECT throws_ok($$UPDATE documents SET owner_id='31000000-0000-0000-0000-000000000004'$$,'42501',NULL,'owner cannot transfer ownership directly');
SELECT is(resolve_share_recipient('32000000-0000-0000-0000-000000000001','RLS-VIEWER@example.test'),'31000000-0000-0000-0000-000000000003'::uuid,'owner resolves exact normalized email');
SELECT is(resolve_share_recipient('32000000-0000-0000-0000-000000000001','%@example.test'),NULL::uuid,'wildcards do not enumerate');
SELECT is(resolve_share_recipient('32000000-0000-0000-0000-000000000001','rls-unverified@example.test'),NULL::uuid,'unverified recipient is absent');
SELECT throws_ok($$SELECT grant_document_share('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000005','view')$$,'42501',NULL,'cannot grant unverified recipient');
SELECT lives_ok($$SELECT create_document('Created','<p>new</p>')$$,'verified user creates');
SELECT is((SELECT count(*)::int FROM document_history WHERE title='Created'),1,'creation includes initial history');
SELECT throws_ok($$SELECT create_document('','invalid')$$,'23514',NULL,'invalid creation rolls back');
SELECT is((SELECT count(*)::int FROM document_history WHERE content='invalid'),0,'failed create leaves no history');
SELECT lives_ok($$SELECT grant_document_share('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000004','view')$$,'owner grants share');
SELECT lives_ok($$SELECT grant_document_share('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000004','edit')$$,'owner upgrades existing share');
SELECT is((SELECT count(*)::int FROM document_shares WHERE user_id='31000000-0000-0000-0000-000000000004' AND permission='edit'),1,'grant upsert preserves unique recipient');
DELETE FROM document_shares WHERE user_id='31000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*)::int FROM documents),0,'revoked share immediately hides document');
SELECT throws_ok($$SELECT update_document('32000000-0000-0000-0000-000000000001','stale')$$,'42501',NULL,'revoked editor JWT cannot write');

SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000005',true);
SELECT is((SELECT count(*)::int FROM documents),0,'unverified cannot read documents');
SELECT throws_ok($$SELECT create_document('bad','')$$,'42501',NULL,'unverified cannot create');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='31000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000003',true);
SELECT is(is_verified_user(),false,'current ban invalidates old JWT');
SELECT is((SELECT count(*)::int FROM documents),0,'banned user cannot read shared document');
RESET ROLE;
UPDATE auth.users SET banned_until=now()-interval '1 hour' WHERE id='31000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT is(is_verified_user(),true,'expired ban restores confirmed account');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=null WHERE id='31000000-0000-0000-0000-000000000001';
SELECT is((SELECT verified FROM profiles WHERE id='31000000-0000-0000-0000-000000000001'),false,'trusted unconfirmation syncs verification');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*)::int FROM documents),0,'old confirmed JWT loses access after unconfirmation');
SELECT throws_ok($$SELECT create_document('stale','')$$,'42501',NULL,'old JWT cannot create after unconfirmation');
RESET ROLE;
DELETE FROM auth.users WHERE id='31000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT create_document('deleted','')$$,'42501',NULL,'deleted user JWT cannot create');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
