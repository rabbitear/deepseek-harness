# The ONE definition of the DeepSeek Harness development environment.
#
# Both entry points import this file, so they cannot drift apart:
#   - flake.nix  -> `nix develop`  (nixpkgs from the flake input, pinned in flake.lock)
#   - shell.nix  -> `nix-shell`    (nixpkgs from <nixpkgs>)
# Change the environment HERE only.
#
# pnpm version pinning (important — do not "fix" this away):
#   We ship nixpkgs pnpm_11 and NO corepack environment variables. Invoked
#   directly, pnpm's own version management reads `packageManager: pnpm@11.7.0`
#   from package.json and pins itself to exactly 11.7.0 on first run (cached
#   under $PNPM_HOME). Setting COREPACK_* makes pnpm believe it runs under
#   corepack, which enables a strict version check that hard-errors instead:
#     "This project is configured to use 11.7.0 of pnpm. Your current pnpm is
#      v11.21.0 ... pnpm does not switch versions when running under corepack."
#
# tsc / tsx / vitest are NOT provided by Nix: the repo pins them as workspace
# devDependencies and a system copy would silently diverge from CI. Use
# `pnpm run <script>` / `pnpm exec <tool>` so node_modules/.bin wins.

{ pkgs ? import <nixpkgs> { }
, withLandlockNative ? false  # musl-targeting gcc for native/landlock-run
}:

let
  nodejs = pkgs.nodejs_24;   # engines: ^22.19.0 || >=24.0.0
  pnpm = pkgs.pnpm_11;       # packageManager: pnpm@11.7.0 (pnpm self-pins, see above)
in
pkgs.mkShell {
  name = "deepseek-harness";

  packages =
    [
      # Core toolchain
      nodejs
      pnpm
      pkgs.git
      pkgs.nodejs

      # POSIX tools needed by pnpm's self-managed version shims, repo scripts,
      # and the bash-based test suites
      pkgs.bash
      pkgs.coreutils
      pkgs.findutils
      pkgs.gnugrep
      pkgs.gnused
      pkgs.gnumake
      pkgs.gnutar
      pkgs.gzip

      # Native-module rebuilds: node-pty ships no prebuilds in this repo
      # (patches/node-pty@1.1.0.patch), so `pnpm install` runs node-gyp,
      # which needs python3 + make + a C compiler.
      pkgs.python3
      pkgs.gcc
    ]
    ++ pkgs.lib.optionals withLandlockNative [
      # There is no pkgs.landlock-linux: Landlock is a Linux kernel feature
      # (>= 5.13), not a package. The repo builds its own static-musl runner
      # from native/landlock-run; this provides a musl-targeting gcc for it.
      pkgs.pkgsCross.musl64.buildPackages.stdenv.cc
    ];

  shellHook = ''
    export NODE_ENV=development
    export CI=false

    # pnpm home: managed pnpm versions + content store. Honors a pre-set
    # PNPM_HOME (jailed/sandboxed sessions with a read-only $HOME).
    export PNPM_HOME="''${PNPM_HOME:-$HOME/.local/share/pnpm}"
    mkdir -p "$PNPM_HOME"

    echo ""
    echo "DeepSeek Harness dev shell  (definition: nix/devshell.nix)"
    echo "  Node.js:  $(node --version)"
    echo "  pnpm:     $(pnpm --version)  (self-pinned to packageManager)"
    echo "  Git:      $(git --version)"
    echo ""
    echo "Quick start:"
    echo "  pnpm install                                            # install workspace"
    echo "  pnpm exec vitest run packages/client/ui-layout-compact  # feature tests"
    echo "  pnpm run test:gui     # client+host tests"
    echo "  pnpm run test         # all unit tests"
    echo "  pnpm run build        # build everything"
    echo "  pnpm run typecheck    # type-check all packages"
    echo "  pytest                # python/sdk tests (pytest.ini)"
  '';
}
