#!/bin/sh

set -eu

release_repository="${COMPARTMENT_RELEASES_REPOSITORY:-compartmentdev/compartment}"
cli_oci_repository="ghcr.io/compartmentdev/compartment-cli"
cosign_version="2.6.1"
oras_version="1.3.3"
kubernetes_cli_certificate_identity="https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes"
kubernetes_cli_certificate_oidc_issuer="https://token.actions.githubusercontent.com"
channel="latest"
version=""
version_argument="0"
bin_dir=""
init_install="0"
init_update="0"
init_login="0"
init_api_url=""
init_email=""
init_organization=""
init_organization_slug=""
init_onboarding_session=""
install_base_domain=""
install_chart_path=""
install_kube_context=""
install_namespace=""
install_release_name=""
install_remote=""
install_values_path=""

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
      init_api_url="$2"
      shift 2
      ;;
    --email)
      init_email="$2"
      shift 2
      ;;
    --organization)
      init_organization="$2"
      shift 2
      ;;
    --organization-slug)
      init_organization_slug="$2"
      shift 2
      ;;
    --onboarding-session)
      init_onboarding_session="$2"
      shift 2
      ;;
    --base-domain)
      install_base_domain="$2"
      shift 2
      ;;
    --values)
      install_values_path="$2"
      shift 2
      ;;
    --chart)
      install_chart_path="$2"
      shift 2
      ;;
    --kube-context)
      install_kube_context="$2"
      shift 2
      ;;
    --namespace)
      install_namespace="$2"
      shift 2
      ;;
    --release-name)
      install_release_name="$2"
      shift 2
      ;;
    --remote)
      install_remote="$2"
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

if [ "$init_install" = "1" ]; then
  if [ -z "$install_values_path" ]; then
    printf 'Expected --values <path> with --init-install.\n' >&2
    exit 1
  fi
  if [ -n "$init_onboarding_session" ]; then
    printf 'Use --onboarding-session only with --init-login.\n' >&2
    exit 1
  fi
elif [ "$init_update" = "1" ]; then
  if [ -z "$install_values_path" ]; then
    printf 'Expected --values <path> with --init-update.\n' >&2
    exit 1
  fi
  if [ -n "$init_api_url" ] || [ -n "$init_email" ] || [ -n "$init_organization" ] || [ -n "$init_organization_slug" ] || [ -n "$init_onboarding_session" ] || [ -n "$install_base_domain" ] || [ -n "$install_remote" ]; then
    printf 'The provided owner, domain, remote, or login arguments are only valid with --init-install or --init-login.\n' >&2
    exit 1
  fi
elif [ "$init_login" = "1" ]; then
  if [ -z "$init_api_url" ]; then
    printf 'Expected --api-url <url> with --init-login.\n' >&2
    exit 1
  fi
  if [ -n "$install_base_domain" ] || [ -n "$install_values_path" ] || [ -n "$init_organization_slug" ] || [ -n "$install_chart_path" ] || [ -n "$install_kube_context" ] || [ -n "$install_namespace" ] || [ -n "$install_release_name" ] || [ -n "$install_remote" ]; then
    printf 'Use Kubernetes lifecycle options only with --init-install or --init-update.\n' >&2
    exit 1
  fi
else
  if [ -n "$init_api_url" ] || [ -n "$init_email" ] || [ -n "$init_organization" ] || [ -n "$init_organization_slug" ] || [ -n "$init_onboarding_session" ] || [ -n "$install_base_domain" ] || [ -n "$install_chart_path" ] || [ -n "$install_kube_context" ] || [ -n "$install_namespace" ] || [ -n "$install_release_name" ] || [ -n "$install_remote" ] || [ -n "$install_values_path" ]; then
    printf 'Use install, update, and login arguments only with --init-install, --init-update, or --init-login.\n' >&2
    exit 1
  fi
fi

case "$channel" in
  latest|main|kubernetes)
    ;;
  *)
    printf 'Unsupported channel: %s\n' "$channel" >&2
    exit 1
    ;;
esac

resolve_main_release_tag() {
  main_ref_url="https://api.github.com/repos/${release_repository}/git/ref/heads/main"
  main_commit_sha="$(
    curl -fsSL "$main_ref_url" \
      | tr -d '\n' \
      | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' \
      | head -n 1
  )"

  if [ -z "$main_commit_sha" ]; then
    printf 'Missing main commit SHA in %s\n' "$main_ref_url" >&2
    exit 1
  fi

  resolved_release_tag="sha-${main_commit_sha}"
  printf 'Resolved main to %s\n' "$resolved_release_tag" >&2
  printf '%s' "$resolved_release_tag"
}

resolve_kubernetes_release_tag() {
  kubernetes_ref_url="https://api.github.com/repos/${release_repository}/git/ref/heads/kubernetes"
  kubernetes_commit_sha="$(
    curl -fsSL "$kubernetes_ref_url" \
      | tr -d '\n' \
      | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' \
      | head -n 1
  )"

  if [ -z "$kubernetes_commit_sha" ]; then
    printf 'Missing kubernetes commit SHA in %s\n' "$kubernetes_ref_url" >&2
    exit 1
  fi

  resolved_release_tag="sha-${kubernetes_commit_sha}"
  printf 'Resolved kubernetes to %s\n' "$resolved_release_tag" >&2
  printf '%s' "$resolved_release_tag"
}

verify_download_checksum() {
  checksum_path="$1"
  checksum_expected="$2"
  checksum_label="$3"

  if command -v sha256sum >/dev/null 2>&1; then
    checksum_actual="$(sha256sum "$checksum_path" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    checksum_actual="$(shasum -a 256 "$checksum_path" | awk '{ print $1 }')"
  else
    printf 'Missing sha256 checksum tool.\n' >&2
    exit 1
  fi

  if [ "$checksum_actual" != "$checksum_expected" ]; then
    printf 'Checksum mismatch for %s\n' "$checksum_label" >&2
    exit 1
  fi
}

prepare_kubernetes_cli_tools() {
  tools_directory="$1"
  tools_target_os="$2"
  tools_target_arch="$3"

  mkdir -p "$tools_directory"
  case "$tools_target_arch" in
    x64)
      tools_upstream_arch="amd64"
      ;;
    arm64)
      tools_upstream_arch="arm64"
      ;;
    *)
      printf 'Unsupported Kubernetes CLI tool architecture: %s\n' "$tools_target_arch" >&2
      exit 1
      ;;
  esac

  if command -v cosign >/dev/null 2>&1; then
    cosign_command="$(command -v cosign)"
  else
    cosign_command="${tools_directory}/cosign"
    cosign_asset_name="cosign-${tools_target_os}-${tools_upstream_arch}"
    case "${tools_target_os}-${tools_upstream_arch}" in
      darwin-amd64)
        cosign_checksum="f1ed2787cc9648fd3c644fcb279e43f3f55da63b788d69a527aa14ad97ffdca1"
        ;;
      darwin-arm64)
        cosign_checksum="54047052cf46f40a5c3c95a510db276e164ba77e096aea1ca1b733f770359689"
        ;;
      linux-amd64)
        cosign_checksum="064954c5d8c7e3b28188eee5b1727b31c411550bc5fefd41aa672d3c761d103a"
        ;;
      linux-arm64)
        cosign_checksum="56a16480bdd56ec789abaa65924402f6b92c0041f06885995853c05567b76f34"
        ;;
    esac
    curl -fsSL \
      -o "$cosign_command" \
      "https://github.com/sigstore/cosign/releases/download/v${cosign_version}/${cosign_asset_name}"
    verify_download_checksum "$cosign_command" "$cosign_checksum" "$cosign_asset_name"
    chmod 0755 "$cosign_command"
  fi

  if command -v oras >/dev/null 2>&1; then
    oras_command="$(command -v oras)"
  else
    oras_command="${tools_directory}/oras"
    oras_asset_name="oras_${oras_version}_${tools_target_os}_${tools_upstream_arch}.tar.gz"
    oras_archive_path="${tools_directory}/${oras_asset_name}"
    case "${tools_target_os}-${tools_upstream_arch}" in
      darwin-amd64)
        oras_checksum="aeb684d8c24c18dce28fd1f7326636e4782b573108e244a93d4b1c4a5ec50f48"
        ;;
      darwin-arm64)
        oras_checksum="f33fc12753c54172b0d0d19eaa0318d3f90fe9b094d96e8b259c881713c92e1c"
        ;;
      linux-amd64)
        oras_checksum="9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59"
        ;;
      linux-arm64)
        oras_checksum="ac7156f93a21e903f7ad606c792f3560f17e0cd0e36365634701b1e7cc4e4eca"
        ;;
    esac
    curl -fsSL \
      -o "$oras_archive_path" \
      "https://github.com/oras-project/oras/releases/download/v${oras_version}/${oras_asset_name}"
    verify_download_checksum "$oras_archive_path" "$oras_checksum" "$oras_asset_name"
    tar -xzf "$oras_archive_path" -C "$tools_directory" oras
    chmod 0755 "$oras_command"
  fi
}

resolve_kubernetes_cli_digest_ref() {
  cli_tag_ref="$1"
  cli_manifest_digest="$("$oras_command" resolve "$cli_tag_ref")"
  validated_cli_manifest_digest="$(
    printf '%s\n' "$cli_manifest_digest" | sed -n '/^sha256:[0-9a-f]\{64\}$/p'
  )"
  if [ -z "$validated_cli_manifest_digest" ]; then
    printf 'Invalid OCI manifest digest for %s: %s\n' "$cli_tag_ref" "$cli_manifest_digest" >&2
    exit 1
  fi

  printf '%s@%s' "$cli_oci_repository" "$validated_cli_manifest_digest"
}

verify_kubernetes_cli_artifact() {
  cli_digest_ref="$1"
  if ! "$cosign_command" verify \
    --new-bundle-format \
    --certificate-identity "$kubernetes_cli_certificate_identity" \
    --certificate-oidc-issuer "$kubernetes_cli_certificate_oidc_issuer" \
    "$cli_digest_ref" >/dev/null; then
    printf 'Failed to verify Kubernetes CLI artifact %s\n' "$cli_digest_ref" >&2
    exit 1
  fi
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

format_init_install_command() {
  format_install_path="$1"
  format_install_api_url="$2"
  format_install_base_domain="$3"
  format_install_values_path="$4"
  format_install_email="$5"
  format_install_organization="$6"
  format_install_organization_slug="$7"
  format_install_kube_context="$8"
  format_install_namespace="$9"
  shift 9
  format_install_release_name="$1"
  format_install_chart_path="$2"
  format_install_remote="$3"
  format_install_command="$(printf '"%s" install --values %s' \
    "$format_install_path" \
    "$(quote_shell_argument "$format_install_values_path")")"

  if [ -n "$format_install_api_url" ]; then
    format_install_command="${format_install_command} --api-url $(quote_shell_argument "$format_install_api_url")"
  fi
  if [ -n "$format_install_base_domain" ]; then
    format_install_command="${format_install_command} --base-domain $(quote_shell_argument "$format_install_base_domain")"
  fi
  if [ -n "$format_install_email" ]; then
    format_install_command="${format_install_command} --email $(quote_shell_argument "$format_install_email")"
  fi
  if [ -n "$format_install_organization" ]; then
    format_install_command="${format_install_command} --organization $(quote_shell_argument "$format_install_organization")"
  fi
  if [ -n "$format_install_organization_slug" ]; then
    format_install_command="${format_install_command} --organization-slug $(quote_shell_argument "$format_install_organization_slug")"
  fi
  if [ -n "$format_install_kube_context" ]; then
    format_install_command="${format_install_command} --kube-context $(quote_shell_argument "$format_install_kube_context")"
  fi
  if [ -n "$format_install_namespace" ]; then
    format_install_command="${format_install_command} --namespace $(quote_shell_argument "$format_install_namespace")"
  fi
  if [ -n "$format_install_release_name" ]; then
    format_install_command="${format_install_command} --release-name $(quote_shell_argument "$format_install_release_name")"
  fi
  if [ -n "$format_install_chart_path" ]; then
    format_install_command="${format_install_command} --chart $(quote_shell_argument "$format_install_chart_path")"
  fi
  if [ -n "$format_install_remote" ]; then
    format_install_command="${format_install_command} --remote $(quote_shell_argument "$format_install_remote")"
  fi

  printf '%s' "$format_install_command"
}

run_init_install() {
  init_install_path="$1"
  init_install_api_url="$2"
  init_install_base_domain="$3"
  init_install_values_path="$4"
  init_install_email="$5"
  init_install_organization="$6"
  init_install_organization_slug="$7"
  init_install_kube_context="$8"
  init_install_namespace="$9"
  shift 9
  init_install_release_name="$1"
  init_install_chart_path="$2"
  init_install_remote="$3"
  init_install_command="$(format_init_install_command "$init_install_path" "$init_install_api_url" "$init_install_base_domain" "$init_install_values_path" "$init_install_email" "$init_install_organization" "$init_install_organization_slug" "$init_install_kube_context" "$init_install_namespace" "$init_install_release_name" "$init_install_chart_path" "$init_install_remote")"

  if ! can_use_installer_terminal; then
    printf 'Requested `--init-install`, but no terminal is available for owner setup. Run `%s` from an interactive shell.\n' "$init_install_command" >&2
    exit 1
  fi

  set -- install --values "$init_install_values_path"
  if [ -n "$init_install_api_url" ]; then
    set -- "$@" --api-url "$init_install_api_url"
  fi
  if [ -n "$init_install_base_domain" ]; then
    set -- "$@" --base-domain "$init_install_base_domain"
  fi
  if [ -n "$init_install_email" ]; then
    set -- "$@" --email "$init_install_email"
  fi
  if [ -n "$init_install_organization" ]; then
    set -- "$@" --organization "$init_install_organization"
  fi
  if [ -n "$init_install_organization_slug" ]; then
    set -- "$@" --organization-slug "$init_install_organization_slug"
  fi
  if [ -n "$init_install_kube_context" ]; then
    set -- "$@" --kube-context "$init_install_kube_context"
  fi
  if [ -n "$init_install_namespace" ]; then
    set -- "$@" --namespace "$init_install_namespace"
  fi
  if [ -n "$init_install_release_name" ]; then
    set -- "$@" --release-name "$init_install_release_name"
  fi
  if [ -n "$init_install_chart_path" ]; then
    set -- "$@" --chart "$init_install_chart_path"
  fi
  if [ -n "$init_install_remote" ]; then
    set -- "$@" --remote "$init_install_remote"
  fi

  printf 'Running `%s` for Kubernetes platform and owner setup.\n' "$init_install_command"
  if can_write_installer_terminal; then
    "$init_install_path" "$@" </dev/tty >/dev/tty 2>/dev/tty
    return 0
  fi

  "$init_install_path" "$@" </dev/tty
}

run_init_update() {
  init_update_path="$1"
  init_update_values_path="$2"
  init_update_kube_context="$3"
  init_update_namespace="$4"
  init_update_release_name="$5"
  init_update_chart_path="$6"
  set -- system update --values "$init_update_values_path"
  if [ -n "$init_update_kube_context" ]; then
    set -- "$@" --kube-context "$init_update_kube_context"
  fi
  if [ -n "$init_update_namespace" ]; then
    set -- "$@" --namespace "$init_update_namespace"
  fi
  if [ -n "$init_update_release_name" ]; then
    set -- "$@" --release-name "$init_update_release_name"
  fi
  if [ -n "$init_update_chart_path" ]; then
    set -- "$@" --chart "$init_update_chart_path"
  fi
  printf 'Running Compartment Kubernetes platform update.\n'
  "$init_update_path" "$@"
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

if [ "$channel" != "kubernetes" ]; then
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
fi

temp_directory="$(mktemp -d)"
trap 'rm -rf "$temp_directory"' EXIT INT TERM

artifact_path="${temp_directory}/${artifact_name}"
checksums_path="${temp_directory}/checksums.txt"

if [ "$channel" = "kubernetes" ]; then
  resolved_release_tag="$(resolve_kubernetes_release_tag)"
  prepare_kubernetes_cli_tools "${temp_directory}/tools" "$target_os" "$target_arch"
  cli_tag_ref="${cli_oci_repository}:${resolved_release_tag}"
  cli_digest_ref="$(resolve_kubernetes_cli_digest_ref "$cli_tag_ref")"
  verify_kubernetes_cli_artifact "$cli_digest_ref"
  "$oras_command" pull \
    --platform "${target_os}/${tools_upstream_arch}" \
    --output "$temp_directory" \
    "$cli_digest_ref"
else
  curl -fsSL -o "$artifact_path" "$artifact_url"
  curl -fsSL -o "$checksums_path" "$checksums_url"
fi

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
  run_init_install "$install_path" "$init_api_url" "$install_base_domain" "$install_values_path" "$init_email" "$init_organization" "$init_organization_slug" "$install_kube_context" "$install_namespace" "$install_release_name" "$install_chart_path" "$install_remote"
  exit 0
fi

if [ "$init_update" = "1" ]; then
  run_init_update "$install_path" "$install_values_path" "$install_kube_context" "$install_namespace" "$install_release_name" "$install_chart_path"
  exit 0
fi

if [ "$init_login" = "1" ]; then
  run_init_login "$install_path" "$init_api_url" "$init_email" "$init_organization" "$init_onboarding_session"
  exit 0
fi

printf 'Installed CLI. Run `"%s" install` to create a Kubernetes platform owner, run `"%s" login` to connect to a platform, or use `--init-install`/`--init-update`/`--init-login`.\n' "$install_path" "$install_path"
