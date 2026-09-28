alter table public.trip_lobbies
  drop constraint trip_lobbies_background_consistency_check;

alter table public.trip_lobbies
  add constraint trip_lobbies_background_consistency_check
  check (
    (
      background_kind = 'preset'
      and preset_key is not null
      and preset_key in ('cozy', 'cabin', 'beach', 'chill')
      and custom_storage_path is null
    )
    or
    (
      background_kind = 'custom'
      and preset_key is null
      and custom_storage_path is not null
    )
  );
