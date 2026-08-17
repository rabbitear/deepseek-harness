{
  description = "DeepSeek Harness — plugin-based agent harness (dev shell)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      # Thin: the environment itself lives in nix/devshell.nix, shared with
      # shell.nix — edit it there, not here.
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = import ./nix/devshell.nix { inherit pkgs; };
        });
    };
}
