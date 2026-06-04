#!/bin/sh

set -eu

release_repository="${COMPARTMENT_RELEASES_REPOSITORY:-compartmentdev/compartment}"
channel="latest"
version=""
version_argument="0"
bin_dir=""
init_install="0"
init_update="0"
init_login="0"
login_api_url=""
login_email=""
login_organization=""
login_onboarding_session=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel)
      channel="$2"
      if [ "$version_argument" = "0" ]; then
        version=""
      fi
      shift 2
      ;;
    --version)
      version="$2"
      version_argument="1"
      shift 2
      ;;
    --bin-dir)
      bin_dir="$2"
      shift 2
      ;;
    --init-install)
      init_install="1"
      shift
      ;;
    --init-update)
      init_update="1"
      shift
      ;;
    --init-login)
      init_login="1"
      shift
      ;;
    --api-url)
      login_api_url="$2"
      shift 2
      ;;
    --email)
      login_email="$2"
      shift 2
      ;;
    --organization)
      login_organization="$2"
      shift 2
      ;;
    --onboarding-session)
      login_onboarding_session="$2"
      shift 2
      ;;
    *)
      printf 'Unknown installer argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [ "$version_argument" = "1" ] && [ "$channel" != "latest" ]; then
  printf 'Choose either --version or --channel, not both.\n' >&2
  exit 1
fi

init_mode_count=0
if [ "$init_install" = "1" ]; then
  init_mode_count=$((init_mode_count + 1))
fi
if [ "$init_update" = "1" ]; then
  init_mode_count=$((init_mode_count + 1))
fi
if [ "$init_login" = "1" ]; then
  init_mode_count=$((init_mode_count + 1))
fi

if [ "$init_mode_count" -gt 1 ]; then
  printf 'Choose at most one of --init-install, --init-update, or --init-login.\n' >&2
  exit 1
fi

if [ "$init_login" = "1" ]; then
  if [ -z "$login_api_url" ]; then
    printf 'Expected --api-url <url> with --init-login.\n' >&2
    exit 1
  fi
else
  if [ -n "$login_api_url" ] || [ -n "$login_email" ] || [ -n "$login_organization" ] || [ -n "$login_onboarding_session" ]; then
    printf 'Use --api-url, --email, --organization, and --onboarding-session only with --init-login.\n' >&2
    exit 1
  fi
fi

case "$channel" in
  latest|main)
    ;;
  *)
    printf 'Unsupported channel: %s\n' "$channel" >&2
    exit 1
    ;;
esac

resolve_main_release_tag() {
  main_commit_url="https://api.github.com/repos/${release_repository}/commits/main"
  main_commit_sha="$(
    curl -fsSL "$main_commit_url" \
      | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-f]\{40\}\)",\{0,1\}[[:space:]]*$/\1/p' \
      | head -n 1
  )"

  if [ -z "$main_commit_sha" ]; then
    printf 'Missing main commit SHA in %s\n' "$main_commit_url" >&2
    exit 1
  fi

  resolved_release_tag="sha-${main_commit_sha}"
  printf 'Resolved main to %s\n' "$resolved_release_tag" >&2
  printf '%s' "$resolved_release_tag"
}

can_use_installer_terminal() {
  (
    exec </dev/tty
  ) >/dev/null 2>&1
}

can_write_installer_terminal() {
  (
    exec >/dev/tty
  ) >/dev/null 2>&1
}

write_installer_terminal_prompt() {
  prompt_text="$1"
  if can_write_installer_terminal; then
    printf '%s' "$prompt_text" >/dev/tty
    return 0
  fi

  printf '%s' "$prompt_text" >&2
}

quote_shell_argument() {
  quote_value="$1"
  case "$quote_value" in
    *[!A-Za-z0-9_./:=@+-]*)
      printf "'%s'" "$(printf '%s' "$quote_value" | sed "s/'/'\\\\''/g")"
      ;;
    *)
      printf '%s' "$quote_value"
      ;;
  esac
}

format_init_login_command() {
  format_login_path="$1"
  format_login_api_url="$2"
  format_login_email="$3"
  format_login_organization="$4"
  format_login_onboarding_session="$5"

  format_login_command="$(printf '"%s" login --api-url %s --email %s' \
    "$format_login_path" \
    "$(quote_shell_argument "$format_login_api_url")" \
    "$(quote_shell_argument "$format_login_email")")"

  if [ -n "$format_login_organization" ]; then
    format_login_command="${format_login_command} --organization $(quote_shell_argument "$format_login_organization")"
  fi

  if [ -n "$format_login_onboarding_session" ]; then
    format_login_command="${format_login_command} --onboarding-session $(quote_shell_argument "$format_login_onboarding_session")"
  fi

  printf '%s' "$format_login_command"
}

read_init_login_email() {
  read_login_email="$1"
  if [ -n "$read_login_email" ]; then
    printf '%s' "$read_login_email"
    return 0
  fi

  if ! can_use_installer_terminal; then
    printf 'Requested `--init-login`, but no email was provided and no terminal is available. Re-run with `--email <email>`.\n' >&2
    exit 1
  fi

  write_installer_terminal_prompt 'Email: '
  IFS= read -r read_login_email </dev/tty || read_login_email=""
  if [ -z "$read_login_email" ]; then
    printf 'Expected a non-empty email for --init-login.\n' >&2
    exit 1
  fi

  printf '%s' "$read_login_email"
}

run_init_install() {
  init_install_path="$1"

  if ! can_use_installer_terminal; then
    printf 'Requested `--init-install`, but no terminal is available for sudo and setup prompts. Run `"%s" install` from an interactive shell.\n' "$init_install_path" >&2
    exit 1
  fi

  printf 'Running `"%s" install` for system self-hosted setup.\n' "$init_install_path"
  if can_write_installer_terminal; then
    "$init_install_path" install </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  "$init_install_path" install </dev/tty
}

format_init_update_command() {
  format_update_path="$1"

  printf '"%s" system update' "$format_update_path"
}

run_init_update() {
  init_update_path="$1"
  init_update_command="$(format_init_update_command "$init_update_path")"

  if ! can_use_installer_terminal; then
    printf 'Requested `--init-update`, but no terminal is available for sudo and update prompts. Run `%s` from an interactive shell.\n' "$init_update_command" >&2
    exit 1
  fi

  printf 'Running `%s` for system self-hosted update.\n' "$init_update_command"
  if can_write_installer_terminal; then
    "$init_update_path" system update </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  "$init_update_path" system update </dev/tty
}

run_init_login() {
  init_login_path="$1"
  init_login_api_url="$2"
  init_login_email="$3"
  init_login_organization="$4"
  init_login_onboarding_session="$5"
  resolved_login_email="$(read_init_login_email "$init_login_email")"
  init_login_command="$(format_init_login_command "$init_login_path" "$init_login_api_url" "$resolved_login_email" "$init_login_organization" "$init_login_onboarding_session")"

  if ! can_use_installer_terminal; then
    printf 'Requested `--init-login`, but no terminal is available for the password prompt. Run `%s` from an interactive shell.\n' "$init_login_command" >&2
    exit 1
  fi

  set -- login --api-url "$init_login_api_url" --email "$resolved_login_email"
  if [ -n "$init_login_organization" ]; then
    set -- "$@" --organization "$init_login_organization"
  fi
  if [ -n "$init_login_onboarding_session" ]; then
    set -- "$@" --onboarding-session "$init_login_onboarding_session"
  fi

  printf 'Running `%s` for local CLI login.\n' "$init_login_command"
  if can_write_installer_terminal; then
    "$init_login_path" "$@" </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  "$init_login_path" "$@" </dev/tty
}

is_directory_on_path() {
  path_lookup_directory="$1"
  path_lookup_old_ifs="$IFS"
  IFS=:
  for path_lookup_entry in ${PATH:-}; do
    IFS="$path_lookup_old_ifs"
    if [ "$path_lookup_entry" = "$path_lookup_directory" ]; then
      return 0
    fi
    IFS=:
  done
  IFS="$path_lookup_old_ifs"

  return 1
}

is_user_bin_candidate() {
  user_bin_candidate_directory="$1"
  [ "$user_bin_candidate_directory" = "${HOME}/.local/bin" ] || [ "$user_bin_candidate_directory" = "${HOME}/bin" ]
}

is_usable_user_bin_directory() {
  usable_bin_candidate_directory="$1"
  if [ ! -e "$usable_bin_candidate_directory" ]; then
    return 0
  fi

  if [ ! -d "$usable_bin_candidate_directory" ] || [ ! -w "$usable_bin_candidate_directory" ]; then
    return 1
  fi

  if command -v find >/dev/null 2>&1; then
    usable_bin_owner_match="$(find "$usable_bin_candidate_directory" -prune -user "$(id -u)" -print 2>/dev/null || true)"
    [ -n "$usable_bin_owner_match" ]
    return $?
  fi

  return 0
}

select_user_bin_directory() {
  select_bin_old_ifs="$IFS"
  IFS=:
  for select_bin_path_entry in ${PATH:-}; do
    IFS="$select_bin_old_ifs"
    if is_user_bin_candidate "$select_bin_path_entry" && is_usable_user_bin_directory "$select_bin_path_entry"; then
      printf '%s' "$select_bin_path_entry"
      return 0
    fi
    IFS=:
  done
  IFS="$select_bin_old_ifs"

  printf '%s' "${HOME}/.local/bin"
}

read_shell_name() {
  shell_path="${SHELL:-}"
  printf '%s' "${shell_path##*/}"
}

read_shell_profile_path() {
  shell_name="$1"
  if [ -n "${PROFILE:-}" ]; then
    printf '%s' "$PROFILE"
    return 0
  fi

  case "$shell_name" in
    zsh)
      if [ "$os" = "darwin" ]; then
        printf '%s' "${ZDOTDIR:-$HOME}/.zprofile"
      else
        printf '%s' "${ZDOTDIR:-$HOME}/.zshrc"
      fi
      ;;
    bash)
      if [ "$os" = "darwin" ]; then
        printf '%s' "${HOME}/.bash_profile"
      else
        printf '%s' "${HOME}/.bashrc"
      fi
      ;;
    fish)
      printf '%s' "${HOME}/.config/fish/config.fish"
      ;;
    *)
      printf ''
      ;;
  esac
}

build_path_update_command() {
  path_command_shell_name="$1"
  path_command_directory="$2"
  case "$path_command_shell_name" in
    fish)
      printf 'fish_add_path "%s"' "$path_command_directory"
      ;;
    *)
      printf 'export PATH="%s:$PATH"' "$path_command_directory"
      ;;
  esac
}

print_path_instruction() {
  instruction_path_directory="$1"
  instruction_shell_name="$2"
  instruction_profile_path="$3"
  instruction_path_command="$(build_path_update_command "$instruction_shell_name" "$instruction_path_directory")"
  printf '%s is not on PATH.\n' "$instruction_path_directory"
  if [ -n "$instruction_profile_path" ]; then
    printf 'Add it to %s, or run for this shell: %s\n' "$instruction_profile_path" "$instruction_path_command"
    return 0
  fi

  printf 'Add it to your shell profile, or run for this shell: %s\n' "$instruction_path_command"
}

should_update_shell_profile() {
  prompt_path_directory="$1"
  prompt_profile_path="$2"

  if [ "${COMPARTMENT_INSTALLER_ACCEPT_PATH_UPDATE:-}" = "1" ]; then
    return 0
  fi

  if ! can_use_installer_terminal; then
    return 1
  fi

  write_installer_terminal_prompt "${prompt_path_directory} is not on PATH. Add it to ${prompt_profile_path}? [Y/n] "
  IFS= read -r answer </dev/tty || answer=""
  case "$answer" in
    ""|y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

append_path_update_if_missing() {
  append_profile_path="$1"
  append_path_command="$2"
  append_profile_directory="$(dirname "$append_profile_path")"

  mkdir -p "$append_profile_directory"
  if [ -f "$append_profile_path" ] && grep -F "$append_path_command" "$append_profile_path" >/dev/null 2>&1; then
    return 0
  fi

  {
    printf '\n'
    printf '# Add Compartment CLI to PATH\n'
    printf '%s\n' "$append_path_command"
  } >> "$append_profile_path"
}

ensure_bin_directory_on_path() {
  ensure_bin_directory="$1"
  if is_directory_on_path "$ensure_bin_directory"; then
    return 0
  fi

  ensure_shell_name="$(read_shell_name)"
  ensure_profile_path="$(read_shell_profile_path "$ensure_shell_name")"
  ensure_path_command="$(build_path_update_command "$ensure_shell_name" "$ensure_bin_directory")"

  if [ -z "$ensure_profile_path" ]; then
    print_path_instruction "$ensure_bin_directory" "$ensure_shell_name" ''
    return 0
  fi

  if should_update_shell_profile "$ensure_bin_directory" "$ensure_profile_path"; then
    append_path_update_if_missing "$ensure_profile_path" "$ensure_path_command"
    printf 'Added %s to %s. Restart your shell or run: %s\n' "$ensure_bin_directory" "$ensure_profile_path" "$ensure_path_command"
    return 0
  fi

  print_path_instruction "$ensure_bin_directory" "$ensure_shell_name" "$ensure_profile_path"
}

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  darwin)
    target_os="darwin"
    ;;
  linux)
    target_os="linux"
    ;;
  *)
    printf 'Unsupported operating system: %s\n' "$os" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64)
    target_arch="x64"
    ;;
  arm64|aarch64)
    target_arch="arm64"
    ;;
  *)
    printf 'Unsupported architecture: %s\n' "$arch" >&2
    exit 1
    ;;
esac

artifact_name="compartment-${target_os}-${target_arch}.tar.gz"

if [ -n "$version" ]; then
  case "$version" in
    main)
      resolved_release_tag="$(resolve_main_release_tag)"
      release_path="releases/download/${resolved_release_tag}"
      ;;
    sha-*)
      release_path="releases/download/${version}"
      ;;
    *)
      release_path="releases/download/v${version}"
      ;;
  esac
else
  if [ "$channel" = "main" ]; then
    resolved_release_tag="$(resolve_main_release_tag)"
    release_path="releases/download/${resolved_release_tag}"
  else
    release_path="releases/latest/download"
  fi
fi

base_url="https://github.com/${release_repository}/${release_path}"
artifact_url="${base_url}/${artifact_name}"
checksums_url="${base_url}/checksums.txt"

temp_directory="$(mktemp -d)"
trap 'rm -rf "$temp_directory"' EXIT INT TERM

artifact_path="${temp_directory}/${artifact_name}"
checksums_path="${temp_directory}/checksums.txt"

curl -fsSL -o "$artifact_path" "$artifact_url"
curl -fsSL -o "$checksums_path" "$checksums_url"

expected_checksum_line="$(awk -v target="$artifact_name" '$2 == target { print $0 }' "$checksums_path")"
if [ -z "$expected_checksum_line" ]; then
  printf 'Missing checksum entry for %s\n' "$artifact_name" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s\n' "$expected_checksum_line" | (cd "$temp_directory" && sha256sum -c -)
elif command -v shasum >/dev/null 2>&1; then
  expected_checksum="$(printf '%s\n' "$expected_checksum_line" | awk '{ print $1 }')"
  actual_checksum="$(shasum -a 256 "$artifact_path" | awk '{ print $1 }')"
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    printf 'Checksum mismatch for %s\n' "$artifact_name" >&2
    exit 1
  fi
else
  printf 'Missing sha256 checksum tool.\n' >&2
  exit 1
fi

if [ -z "$bin_dir" ]; then
  bin_dir="$(select_user_bin_directory)"
fi

mkdir -p "$bin_dir"
tar -xzf "$artifact_path" -C "$temp_directory"
install_path="${bin_dir}/compartment"
install -m 0755 "${temp_directory}/compartment" "$install_path"

printf 'Installed compartment to %s\n' "$install_path"
"$install_path" --version
ensure_bin_directory_on_path "$bin_dir"

if [ "$init_install" = "1" ]; then
  run_init_install "$install_path"
  exit 0
fi

if [ "$init_update" = "1" ]; then
  run_init_update "$install_path"
  exit 0
fi

if [ "$init_login" = "1" ]; then
  run_init_login "$install_path" "$login_api_url" "$login_email" "$login_organization" "$login_onboarding_session"
  exit 0
fi

printf 'Installed CLI only. Run `"%s" install` when you are ready, run `sudo "%s" system update` for an existing runtime, or re-run this installer with `--init-install` or `--init-update`.\n' "$install_path" "$install_path"
