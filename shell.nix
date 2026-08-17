# Thin entry point for `nix-shell`. The actual environment lives in
# nix/devshell.nix and is shared with flake.nix — edit it there, not here.
{ pkgs ? import <nixpkgs> { }, withLandlockNative ? false }:
import ./nix/devshell.nix { inherit pkgs withLandlockNative; }
