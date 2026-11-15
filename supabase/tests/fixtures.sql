insert into institutions (id, name) values ('00000000-0000-0000-0000-000000000001','NIE Mysore (pilot)') on conflict do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','student@accessable.demo','{"display_name":"Test Student"}'),
 ('a0000000-0000-0000-0000-000000000002','student2@accessable.demo','{}'),
 ('a0000000-0000-0000-0000-000000000003','admin@accessable.demo','{}'),
 ('a0000000-0000-0000-0000-000000000004','responder@accessable.demo','{}'),
 ('a0000000-0000-0000-0000-000000000005','maintenance@accessable.demo','{}'),
 ('a0000000-0000-0000-0000-000000000006','mapeditor@accessable.demo','{}'),
 ('a0000000-0000-0000-0000-000000000007','responder2@accessable.demo','{}');

insert into role_assignments (user_id, institution_id, role) values
 ('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','admin'),
 ('a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','responder'),
 ('a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','maintenance'),
 ('a0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','map_editor'),
 ('a0000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','responder');

insert into buildings (id, institution_id, code, name) values
 ('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','TB','Test Block');
insert into floors (id, building_id, code, level, name) values
 ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','TB-G',0,'Ground floor');
insert into route_nodes (id, floor_id, code, kind, label, x, y, qr_token) values
 ('c0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','TB-A','corridor','Corridor A',0,0,null),
 ('c0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','TB-B','corridor','Corridor B',10,0,null),
 ('c0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000001','TB-C','corridor','Corridor C',20,0,'TEST-QR');
insert into route_edges (id, code, from_node_id, to_node_id, kind, length_m, step_free) values
 ('e0000000-0000-0000-0000-000000000001','TB-A__TB-B','c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','corridor',10,true),
 ('e0000000-0000-0000-0000-000000000002','TB-B__TB-C','c0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','corridor',10,true);

-- Test helper: user n (1 student, 2 student2, 3 admin, 4 responder, 5 maintenance, 6 mapeditor, 7 responder2)
create function t.u(n int) returns uuid language sql immutable as $$
  select ('a0000000-0000-0000-0000-00000000000' || n)::uuid
$$;
grant execute on function t.u(int) to public;
