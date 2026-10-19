-- Bloqueia a criação de qualquer conta nova (cadastro público desligado).
-- Para liberar um novo usuário no futuro: drop trigger block_new_users on auth.users;
create or replace function public.block_new_users()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Cadastro desativado no Revwin Control.';
end $$;

revoke all on function public.block_new_users() from public, anon, authenticated;

create trigger block_new_users
before insert on auth.users
for each row execute function public.block_new_users();
