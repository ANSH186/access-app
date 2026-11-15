-- Responders can only read profiles of staff and of people who raised an SOS; list_staff works for staff only.
begin;
do $$
declare n int;
begin
  -- responder cannot see student 2's profile (no alert yet)
  perform t.as_user(t.u(4));
  select count(*) into n from profiles where id = t.u(2); assert n = 0, 'responder must not browse student profiles';
  select count(*) into n from profiles where id = t.u(5); assert n = 1, 'responder sees staff profile';
  -- admin sees everyone
  perform t.as_user(t.u(3));
  select count(*) into n from profiles where id = t.u(2); assert n = 1, 'admin sees student';
  -- student 2 raises an SOS -> responder can now read that profile
  perform t.as_user(t.u(2));
  perform create_emergency('privacy-test-1');
  perform t.as_user(t.u(4));
  select count(*) into n from profiles where id = t.u(2); assert n = 1, 'responder sees alerting student';
  select count(*) into n from profiles where id = t.u(1); assert n = 0, 'still not other students';
  -- list_staff
  select count(*) into n from list_staff(array['responder','admin']); assert n = 3, 'responders+admin = 3, got ' || n;
  perform t.as_user(t.u(5));
  select count(*) into n from list_staff(array['maintenance','map_editor','admin']); assert n = 3, 'maint picker = 3, got ' || n;
  select count(*) into n from list_staff(); assert n = 5, 'all staff = 5, got ' || n;
  perform t.as_user(t.u(1));
  perform t.throws('select * from list_staff()', '%Only campus staff%');
end $$;
rollback;
