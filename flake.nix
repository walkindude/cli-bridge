{
  description = "cli-bridge — Turn any CLI into an MCP tool that agents actually use";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version =
          if self ? rev
          then "dev-${builtins.substring 0 7 self.rev}"
          else "dev";
      in {
        packages.default = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "cli-bridge";
          inherit version;
          src = ./.;

          # Replace with the hash `nix build` prints on first build.
          # Bump whenever pnpm-lock.yaml changes. The nix CI job catches drift.
          pnpmDeps = pkgs.pnpm.fetchDeps {
            inherit (finalAttrs) pname version src;
            hash = pkgs.lib.fakeHash;
          };

          nativeBuildInputs = [
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.pnpm.configHook
            pkgs.makeWrapper
          ];

          buildPhase = ''
            runHook preBuild
            pnpm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/cli-bridge
            cp -r dist package.json $out/lib/cli-bridge/
            if [ -d specs ]; then cp -r specs $out/lib/cli-bridge/; fi
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/cli-bridge \
              --add-flags "$out/lib/cli-bridge/dist/cli-bridge.js"
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Turn any CLI into an MCP tool that agents actually use";
            homepage = "https://github.com/walkindude/cli-bridge";
            license = licenses.asl20;
            mainProgram = "cli-bridge";
          };
        });

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            pnpm
            prettier
          ];
        };
      });
}
