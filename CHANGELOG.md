# Changelog

## [0.7.0](https://github.com/compartmentdev/compartment/compare/v0.6.1...v0.7.0) (2026-06-02)


### Features

* **cli:** run self-hosted runtime as non-root ([#75](https://github.com/compartmentdev/compartment/issues/75)) ([7fdde02](https://github.com/compartmentdev/compartment/commit/7fdde0245d01b606fa020f2099ffe18b44dd423e))


### Bug Fixes

* **cli:** harden self-hosted BuildKit transport ([#74](https://github.com/compartmentdev/compartment/issues/74)) ([eea6245](https://github.com/compartmentdev/compartment/commit/eea62454f48608fa9ec5432f4283f99d3ca38b65))
* **cli:** reconcile runtime networks after Caddy restart ([#68](https://github.com/compartmentdev/compartment/issues/68)) ([3026cda](https://github.com/compartmentdev/compartment/commit/3026cda70fe3c9cfcb0f75cdb063acce18b28b10))
* **console:** polish access drawer assignment ui ([#65](https://github.com/compartmentdev/compartment/issues/65)) ([3937ba8](https://github.com/compartmentdev/compartment/commit/3937ba884e820f263cb582b4e986415a1a7dfb8d))

## [0.6.1](https://github.com/compartmentdev/compartment/compare/v0.6.0...v0.6.1) (2026-05-27)


### Bug Fixes

* **cli:** keep sudo docker progress out of spinner ([#67](https://github.com/compartmentdev/compartment/issues/67)) ([bd055d4](https://github.com/compartmentdev/compartment/commit/bd055d4006d22c7f8d6296e4c658bb3aceb08168))

## [0.6.0](https://github.com/compartmentdev/compartment/compare/v0.5.1...v0.6.0) (2026-05-27)


### Features

* **console:** clarify direct assignment scope hierarchy ([#61](https://github.com/compartmentdev/compartment/issues/61)) ([fdb3162](https://github.com/compartmentdev/compartment/commit/fdb31621cb46d75d1f9871d4d1aa1c2b97887038))
* **console:** hide automation users from browser users page ([#60](https://github.com/compartmentdev/compartment/issues/60)) ([effbe8e](https://github.com/compartmentdev/compartment/commit/effbe8e50dd3f71bce2b8909f7340605bee26115))
* **contracts:** align RBAC list contracts across clients ([#62](https://github.com/compartmentdev/compartment/issues/62)) ([8fd2516](https://github.com/compartmentdev/compartment/commit/8fd25168a492da61f0dea7a6b46cdbbfcd3bd326))


### Bug Fixes

* **console:** stabilize access assignment layout ([#64](https://github.com/compartmentdev/compartment/issues/64)) ([1c4bda4](https://github.com/compartmentdev/compartment/commit/1c4bda40cf75acb372959efa618e94ad27c76959))

## [0.5.1](https://github.com/compartmentdev/compartment/compare/v0.5.0...v0.5.1) (2026-05-27)


### Bug Fixes

* **api:** handle system API socket rate limits ([#50](https://github.com/compartmentdev/compartment/issues/50)) ([da799a4](https://github.com/compartmentdev/compartment/commit/da799a45801a28bf30fc5da754a57dcbc3cf9d54))
* **api:** surface node resource readiness errors ([#55](https://github.com/compartmentdev/compartment/issues/55)) ([217dd10](https://github.com/compartmentdev/compartment/commit/217dd10b30a748d1ee957081da98e00d8b6f8c7b))
* **cli:** keep deploy progress on one line ([#57](https://github.com/compartmentdev/compartment/issues/57)) ([8e13799](https://github.com/compartmentdev/compartment/commit/8e137992d51336e64ab521c4d4d74c3f54b6ff98))
* **cli:** show sudo install progress ([#51](https://github.com/compartmentdev/compartment/issues/51)) ([b1c85e7](https://github.com/compartmentdev/compartment/commit/b1c85e730840bc129438608aa6bc9b011e163110))
* **node:** run shell commands via entrypoint ([#56](https://github.com/compartmentdev/compartment/issues/56)) ([b9506e2](https://github.com/compartmentdev/compartment/commit/b9506e2370d637f220d49986606186d4a9757d76))

## [0.5.0](https://github.com/compartmentdev/compartment/compare/v0.4.2...v0.5.0) (2026-05-27)


### Features

* **repo:** add console empty states ([#37](https://github.com/compartmentdev/compartment/issues/37)) ([a7bb1fd](https://github.com/compartmentdev/compartment/commit/a7bb1fd3bdfeaa5d1f75c5f0a7f8db0867a67555))
* **repo:** replace native confirm dialogs in console ([#43](https://github.com/compartmentdev/compartment/issues/43)) ([e80e1f2](https://github.com/compartmentdev/compartment/commit/e80e1f2ebf2b7003bf414a7012762230cfb69eaa))


### Bug Fixes

* **auth:** centralize header and cookie serialization safety ([#34](https://github.com/compartmentdev/compartment/issues/34)) ([ec509cc](https://github.com/compartmentdev/compartment/commit/ec509ccaffd2f0c3c6e3b0b518b45e40e8c78c8e))
* **auth:** enforce single forwarded metadata values ([#35](https://github.com/compartmentdev/compartment/issues/35)) ([9af8700](https://github.com/compartmentdev/compartment/commit/9af8700f33fc8aa69a142fa2571e853bfbda8e73))
* **repo:** stabilize console access drawers ([#49](https://github.com/compartmentdev/compartment/issues/49)) ([0b08074](https://github.com/compartmentdev/compartment/commit/0b08074bc480743b1c1f63c63016e58166b618a0))
* **repo:** stabilize console cleanup e2e ([#41](https://github.com/compartmentdev/compartment/issues/41)) ([19d47be](https://github.com/compartmentdev/compartment/commit/19d47becaa3085f6d174fa42356e2969c6b50e49))
* **repo:** tighten registry location policy ([#36](https://github.com/compartmentdev/compartment/issues/36)) ([b421f7e](https://github.com/compartmentdev/compartment/commit/b421f7efe53b2a49e553e10d0518296340515a6f))

## [0.4.2](https://github.com/compartmentdev/compartment/compare/v0.4.1...v0.4.2) (2026-05-27)


### Bug Fixes

* **repo:** simplify console page headers ([#28](https://github.com/compartmentdev/compartment/issues/28)) ([03f66cd](https://github.com/compartmentdev/compartment/commit/03f66cd402810f0e3a90f5c053603c77f38c46ac))

## [0.4.1](https://github.com/compartmentdev/compartment/compare/v0.4.0...v0.4.1) (2026-05-26)


### Bug Fixes

* **auth:** validate SSO callback query shape ([#29](https://github.com/compartmentdev/compartment/issues/29)) ([34ce297](https://github.com/compartmentdev/compartment/commit/34ce297933508946230320dabe803d0cfdcd7d62))

## [0.4.0](https://github.com/compartmentdev/compartment/compare/v0.3.0...v0.4.0) (2026-05-26)


### Features

* **cli:** default self-hosted images to GHCR ([#27](https://github.com/compartmentdev/compartment/issues/27)) ([8f0e46c](https://github.com/compartmentdev/compartment/commit/8f0e46cff408ee24003b3937ac722a0dc9c7afb2))


### Bug Fixes

* **repo:** align access drawer panels ([#20](https://github.com/compartmentdev/compartment/issues/20)) ([9945bae](https://github.com/compartmentdev/compartment/commit/9945bae0c36655fa02b2db661123ac2832fbc652))
* **repo:** polish audit logs header and table ([#25](https://github.com/compartmentdev/compartment/issues/25)) ([35c6aee](https://github.com/compartmentdev/compartment/commit/35c6aeecab95a5ad0906329d2304f683fa4a39b2))
* **repo:** show installed GitHub account actions ([#24](https://github.com/compartmentdev/compartment/issues/24)) ([738ad3c](https://github.com/compartmentdev/compartment/commit/738ad3cd8c5bbe8aa8489094d2d2edd82ae6aa37))

## [0.3.0](https://github.com/compartmentdev/compartment/compare/v0.2.0...v0.3.0) (2026-05-26)


### Features

* **cli:** add create-flow CLI mode selector ([#14](https://github.com/compartmentdev/compartment/issues/14)) ([b915227](https://github.com/compartmentdev/compartment/commit/b915227034508d4859804cf253b335d4c9290b70))
* **repo:** polish console tabs and tables ([#17](https://github.com/compartmentdev/compartment/issues/17)) ([11b0c78](https://github.com/compartmentdev/compartment/commit/11b0c78395fc42127a1f0abd9ef8505e9129a3ad))

## [0.2.0](https://github.com/compartmentdev/compartment/compare/v0.1.1...v0.2.0) (2026-05-26)


### Features

* **cli:** harden self-hosted install contract ([#13](https://github.com/compartmentdev/compartment/issues/13)) ([86d6fe4](https://github.com/compartmentdev/compartment/commit/86d6fe4e932d2e5ab6ed2a2c71c5cdc90ec29777))


### Bug Fixes

* **auth:** reject duplicate SSO callback params ([#12](https://github.com/compartmentdev/compartment/issues/12)) ([d54c68d](https://github.com/compartmentdev/compartment/commit/d54c68d600912205e8017f80f6acb20cac48d7a8))
* **cli:** match Docker Hub repo digests ([#11](https://github.com/compartmentdev/compartment/issues/11)) ([43a4860](https://github.com/compartmentdev/compartment/commit/43a4860799e1afe7b455948707d3900f75e1bb90))

## [0.1.1](https://github.com/compartmentdev/compartment/compare/v0.1.0...v0.1.1) (2026-05-26)


### Bug Fixes

* **node:** constrain resource operation backup mounts ([#3](https://github.com/compartmentdev/compartment/issues/3)) ([f139a9b](https://github.com/compartmentdev/compartment/commit/f139a9bf22735bb10140f4c1f7dd4fed4685dec1))
* **repo:** reject multi-root github archives ([#2](https://github.com/compartmentdev/compartment/issues/2)) ([b8156cb](https://github.com/compartmentdev/compartment/commit/b8156cb7d2487957213d3fbcc1e8c5b937e15e15))

## Changelog
