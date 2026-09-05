-- =============================================================================
-- HM2 Sales Command Center - Stage 1: storage bucket for HM photos
-- -----------------------------------------------------------------------------
-- Photos live in Supabase Storage; the database only ever holds the URL/path in
-- hms.photo_url. No binary data in Postgres.
--
-- The bucket is READ-PUBLIC on purpose: a later stage serves an HM-facing
-- read-only dashboard with no login, and those pages need to render the same
-- avatars without minting signed URLs on every request. Writes are locked to
-- authenticated staff, so nobody can replace or delete an HM photo.
--
-- If the team later decides headshots must not be world-readable, flip
-- `public` to false here and switch the app to createSignedUrl(); no other
-- change is required because callers go through one helper.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hm-photos',
  'hm-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone. Matches `public = true` on the bucket and keeps the policy
-- explicit rather than implied.
drop policy if exists hm_photos_read on storage.objects;
create policy hm_photos_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'hm-photos');

-- Write: active manager or PA only.
drop policy if exists hm_photos_insert_staff on storage.objects;
create policy hm_photos_insert_staff
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'hm-photos' and public.is_staff());

drop policy if exists hm_photos_update_staff on storage.objects;
create policy hm_photos_update_staff
  on storage.objects for update
  to authenticated
  using (bucket_id = 'hm-photos' and public.is_staff())
  with check (bucket_id = 'hm-photos' and public.is_staff());

drop policy if exists hm_photos_delete_staff on storage.objects;
create policy hm_photos_delete_staff
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'hm-photos' and public.is_staff());
