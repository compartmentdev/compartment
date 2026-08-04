# Changelog

## [0.10.2](https://github.com/compartmentdev/compartment/compare/v0.10.1...v0.10.2) (2026-08-04)


### Bug Fixes

* **docs:** prioritize Kubernetes install guidance ([#285](https://github.com/compartmentdev/compartment/issues/285)) ([adaf528](https://github.com/compartmentdev/compartment/commit/adaf5281fac577a4d610f04540f8916b52edfd11))
* **docs:** resolve browser contracts from source ([#282](https://github.com/compartmentdev/compartment/issues/282)) ([1a9270e](https://github.com/compartmentdev/compartment/commit/1a9270e5a987fe4521a268e257712bdd3d03066d))
* **docs:** restore install and operate guides ([#284](https://github.com/compartmentdev/compartment/issues/284)) ([cb3fa0b](https://github.com/compartmentdev/compartment/commit/cb3fa0b9b4318a4595f1f809720efaec2ed871ba))
* **worker:** stream sandbox build progress live ([#277](https://github.com/compartmentdev/compartment/issues/277)) ([19884ce](https://github.com/compartmentdev/compartment/commit/19884cece9813d40e8b75f9bbd3750beeb2154e7))

## [0.10.1](https://github.com/compartmentdev/compartment/compare/v0.10.0...v0.10.1) (2026-08-04)


### Bug Fixes

* **cli:** clarify install prompts ([#280](https://github.com/compartmentdev/compartment/issues/280)) ([6b79696](https://github.com/compartmentdev/compartment/commit/6b79696fe3dbc2735665798158c5cdafb56ea52f))
* **console:** remove legacy installer URL ([#278](https://github.com/compartmentdev/compartment/issues/278)) ([82d3500](https://github.com/compartmentdev/compartment/commit/82d35002c3d035773eade59a9c287f36d9cbde50))

## [0.10.0](https://github.com/compartmentdev/compartment/compare/v0.9.2...v0.10.0) (2026-08-04)


### ⚠ BREAKING CHANGES

* **api:** Existing installations cannot upgrade across the Docker-to-Kubernetes cutover; a clean reinstall is required.

### Features

* **api:** encrypt tenant secret values at rest ([#221](https://github.com/compartmentdev/compartment/issues/221)) ([a149bd7](https://github.com/compartmentdev/compartment/commit/a149bd78a50ebfd3fd78fc21f9dd47b64755e2f0))
* **api:** meter tenant workload usage ([#216](https://github.com/compartmentdev/compartment/issues/216)) ([59607c7](https://github.com/compartmentdev/compartment/commit/59607c7533dda529e1d6bbc82056affdceaf8117))
* **api:** squash migrations into kubernetes-era 0000_initial baseline ([#114](https://github.com/compartmentdev/compartment/issues/114)) ([41a628b](https://github.com/compartmentdev/compartment/commit/41a628bc451846ce412c6be9c6cb130d303f6d15))
* **chart:** restore rollback-retention and auth-throttle operator values ([#135](https://github.com/compartmentdev/compartment/issues/135)) ([5db1b0d](https://github.com/compartmentdev/compartment/commit/5db1b0d7242b0ea7b705b71410b6855d650c2b12))
* **cli:** add existing Kubernetes install input ([#198](https://github.com/compartmentdev/compartment/issues/198)) ([4546bba](https://github.com/compartmentdev/compartment/commit/4546bba56cea67194a8fef6c55a93f410bc0fb6c))
* **cli:** add managed-domain DNS-01 TLS lifecycle ([#201](https://github.com/compartmentdev/compartment/issues/201)) ([3631d1a](https://github.com/compartmentdev/compartment/commit/3631d1a2b477da82c7de6063daa228a18ec0d9fa))
* **cli:** add signed kubernetes install channel ([#150](https://github.com/compartmentdev/compartment/issues/150)) ([9e03e60](https://github.com/compartmentdev/compartment/commit/9e03e606a9e09d10c90c365fee697c3d9d9b3f17))
* **cli:** finish the registry mirror step after install ([#163](https://github.com/compartmentdev/compartment/issues/163)) ([9705325](https://github.com/compartmentdev/compartment/commit/97053251d59255f9f215108af271653e0c87d9ce))
* **cli:** guided install wizard with preflight checks ([#159](https://github.com/compartmentdev/compartment/issues/159)) ([807b947](https://github.com/compartmentdev/compartment/commit/807b9473011c88032716428199e2f4438162bdd0))
* **cli:** provision Kubernetes on managed VMs ([#259](https://github.com/compartmentdev/compartment/issues/259)) ([cebe1d5](https://github.com/compartmentdev/compartment/commit/cebe1d5fad1a4104db8561f9ffaf3e6e721647c4))
* **cli:** remove obsolete dedicated cluster topology ([#208](https://github.com/compartmentdev/compartment/issues/208)) ([448d58b](https://github.com/compartmentdev/compartment/commit/448d58b1f68772a01549a0de80f9fcc46226086a))
* **cli:** resilient install with phased progress and retries ([#164](https://github.com/compartmentdev/compartment/issues/164)) ([57c358d](https://github.com/compartmentdev/compartment/commit/57c358daa28f400ce9a0cfd35af11e295b59068a))
* **cli:** restore domains and TLS on Kubernetes ([#123](https://github.com/compartmentdev/compartment/issues/123)) ([4c97027](https://github.com/compartmentdev/compartment/commit/4c970278d2bcd443161f4223be4bd0fc594cfca3))
* **cli:** restore Kubernetes image trust and discovery ([#126](https://github.com/compartmentdev/compartment/issues/126)) ([71ea348](https://github.com/compartmentdev/compartment/commit/71ea3487803a521533185203931fac21bd6feacc))
* **cli:** restore Kubernetes operator workflows ([#125](https://github.com/compartmentdev/compartment/issues/125)) ([47cbf4c](https://github.com/compartmentdev/compartment/commit/47cbf4c27c1e467eb901704dd35731c9762975dc))
* **cli:** restore Kubernetes system updates ([#253](https://github.com/compartmentdev/compartment/issues/253)) ([749f427](https://github.com/compartmentdev/compartment/commit/749f427f5bb16132d7043d48c7a468784f021a0e))
* **cli:** restore managed install hand-off and verified platform operations ([#134](https://github.com/compartmentdev/compartment/issues/134)) ([37a8a8a](https://github.com/compartmentdev/compartment/commit/37a8a8a484d53d264b376bd7ebeda27725167df8))
* **cli:** restore production k8s install + first-owner bootstrap ([#121](https://github.com/compartmentdev/compartment/issues/121)) ([83cfbfa](https://github.com/compartmentdev/compartment/commit/83cfbfa032dcf2da954e1683c0f180456a4d2958))
* **contracts:** accept deprecated restart fields with compatibility warnings ([#136](https://github.com/compartmentdev/compartment/issues/136)) ([16dd82c](https://github.com/compartmentdev/compartment/commit/16dd82cf75eb5e9fa0137db4ba1c1ff209c347d0))
* **deploy:** add minimal HA for api, edge, and caddy ([#231](https://github.com/compartmentdev/compartment/issues/231)) ([2550faf](https://github.com/compartmentdev/compartment/commit/2550fafe7b1af47914e6f9db63d6d6c23df7ce90))
* **edge:** add per-app rate limiting and connection caps ([ea6edda](https://github.com/compartmentdev/compartment/commit/ea6edda1547af8e6e02a498e8111fdc0843ef8ae))
* **edge:** meter hosted application traffic ([5fe82b7](https://github.com/compartmentdev/compartment/commit/5fe82b771fe061b2b3ff15bd42677ff86a3ca75e))
* **edge:** persist last-known-good snapshot ([#110](https://github.com/compartmentdev/compartment/issues/110)) ([5d3c856](https://github.com/compartmentdev/compartment/commit/5d3c856b39607097ac6a95dc02121fab0cf39aac))
* **kube-runtime:** add cluster build pipeline ([#107](https://github.com/compartmentdev/compartment/issues/107)) ([8002db9](https://github.com/compartmentdev/compartment/commit/8002db98b0357cf6ad81646a367cb0ef5d000e26))
* **kube-runtime:** add durable product observability ([#113](https://github.com/compartmentdev/compartment/issues/113)) ([28cc2d0](https://github.com/compartmentdev/compartment/commit/28cc2d0d155d6e56a67ef885cf957d2926d1070b))
* **kube-runtime:** add node pools and platform priority classes ([#214](https://github.com/compartmentdev/compartment/issues/214)) ([e56c9e3](https://github.com/compartmentdev/compartment/commit/e56c9e312dd4d94d9db3383c8007d52b41bc8549))
* **kube-runtime:** add platform Helm and k3d harness ([#112](https://github.com/compartmentdev/compartment/issues/112)) ([3a691e3](https://github.com/compartmentdev/compartment/commit/3a691e33ef001a89bda91d76c76ec9690f52d2a8))
* **kube-runtime:** add tenant gVisor RuntimeClass sandbox ([#218](https://github.com/compartmentdev/compartment/issues/218)) ([3d2d465](https://github.com/compartmentdev/compartment/commit/3d2d465d47e854719cd035837bab5dce079c1bd2))
* **kube-runtime:** block tenant egress to RFC1918 networks by default ([#194](https://github.com/compartmentdev/compartment/issues/194)) ([92f7537](https://github.com/compartmentdev/compartment/commit/92f7537e52651a84f80ce48d44c0b8444da6e7a5))
* **kube-runtime:** enforce project organization isolation ([#204](https://github.com/compartmentdev/compartment/issues/204)) ([09e4129](https://github.com/compartmentdev/compartment/commit/09e4129e7a982bcc6b8254d64022ad4944459d8b))
* **kube-runtime:** generate project network policies ([#104](https://github.com/compartmentdev/compartment/issues/104)) ([9535923](https://github.com/compartmentdev/compartment/commit/95359231601c6daf76f6a148a3c6aa3058011b20))
* **kube-runtime:** manage stateful resource lifecycle ([#109](https://github.com/compartmentdev/compartment/issues/109)) ([7da1fa2](https://github.com/compartmentdev/compartment/commit/7da1fa2d8b21ef1aa3b6e3facfee09cfe6bb765f))
* **kube-runtime:** provision secrets and project RBAC ([#102](https://github.com/compartmentdev/compartment/issues/102)) ([811515b](https://github.com/compartmentdev/compartment/commit/811515b211388f06b0e07c404df2f81f6cfeaa93))
* **kube-runtime:** route Caddy behind shared Ingress ([#199](https://github.com/compartmentdev/compartment/issues/199)) ([6cd64f3](https://github.com/compartmentdev/compartment/commit/6cd64f3ae1b91d4e9de4ece0d2467676f40b9c3d))
* **release:** finalize Kubernetes acceptance ([#209](https://github.com/compartmentdev/compartment/issues/209)) ([0f88f57](https://github.com/compartmentdev/compartment/commit/0f88f573090dd2c9346096f215ccbe7dfb7cf3c9))
* **release:** move kubernetes to the main release line ([#274](https://github.com/compartmentdev/compartment/issues/274)) ([3beb28f](https://github.com/compartmentdev/compartment/commit/3beb28f41dcf05eb3741e8cce6168104212be5ec))
* restore production install/domain/operator docs and managed e2e ([#127](https://github.com/compartmentdev/compartment/issues/127)) ([66279dc](https://github.com/compartmentdev/compartment/commit/66279dc48b369b8cfd15f8547f463ede7732f851))
* **root-config:** add S3 registry storage ([#217](https://github.com/compartmentdev/compartment/issues/217)) ([d7cea10](https://github.com/compartmentdev/compartment/commit/d7cea10453b5ab5058ff158953c136542b570e7f))
* **root-config:** preserve Kubernetes lifecycle state ([#258](https://github.com/compartmentdev/compartment/issues/258)) ([e50b30a](https://github.com/compartmentdev/compartment/commit/e50b30a0e1d1b88371e018110c16061e65298903))
* **worker:** add durable Kubernetes product jobs ([#103](https://github.com/compartmentdev/compartment/issues/103)) ([bc2f60c](https://github.com/compartmentdev/compartment/commit/bc2f60c0c30e0201b23efd07d7ef9fc61827046a))
* **worker:** add fair-share build queue ([#241](https://github.com/compartmentdev/compartment/issues/241)) ([59ef36d](https://github.com/compartmentdev/compartment/commit/59ef36d20d23bc09ac89e4f2ed389895f72086e3))
* **worker:** add Kubernetes runtime foundation ([#101](https://github.com/compartmentdev/compartment/issues/101)) ([14e77e7](https://github.com/compartmentdev/compartment/commit/14e77e7d35791da8683978d52234dd94d57771a0))
* **worker:** add project-scoped private registry ([#200](https://github.com/compartmentdev/compartment/issues/200)) ([5245d23](https://github.com/compartmentdev/compartment/commit/5245d237287fe77eb41127f7945ba8c46bb3be2e))
* **worker:** add rolling Kubernetes deployments ([#108](https://github.com/compartmentdev/compartment/issues/108)) ([80e338f](https://github.com/compartmentdev/compartment/commit/80e338f2ceabba29494bf11d32df6d5211482023))
* **worker:** elect a single active worker leader ([#247](https://github.com/compartmentdev/compartment/issues/247)) ([0f41106](https://github.com/compartmentdev/compartment/commit/0f4110672e811782351cfe9df918610d74ccc1db))
* **worker:** isolate builds in per-build sandboxed pods ([#234](https://github.com/compartmentdev/compartment/issues/234)) ([902c9be](https://github.com/compartmentdev/compartment/commit/902c9bec7f9be1ae5b2b294169e7d2ffb360c78e))
* **worker:** reconcile custom domains durably ([#205](https://github.com/compartmentdev/compartment/issues/205)) ([ea8652c](https://github.com/compartmentdev/compartment/commit/ea8652c307ed72bf4ed1ea8c685b360a3ea6b9a6))


### Bug Fixes

* **api:** audit privileged tenant operations ([#246](https://github.com/compartmentdev/compartment/issues/246)) ([00e0b70](https://github.com/compartmentdev/compartment/commit/00e0b70a11741e79675733c4eb8ebf6aec71ccf5))
* **api:** clean retained backup artifacts ([#242](https://github.com/compartmentdev/compartment/issues/242)) ([235969e](https://github.com/compartmentdev/compartment/commit/235969e1416baf52a65ad9e7d85b1d9b811327d4))
* **api:** correct Kubernetes deploy reconciliation state ([#143](https://github.com/compartmentdev/compartment/issues/143)) ([a03dae9](https://github.com/compartmentdev/compartment/commit/a03dae92fa865a398509a890a2b68cac2c650c6d))
* **api:** defer Kubernetes route cutover until ready ([#111](https://github.com/compartmentdev/compartment/issues/111)) ([b408068](https://github.com/compartmentdev/compartment/commit/b408068dfb20ffb1f7e8c22e7182f93654b82c1e))
* **api:** fail releases for terminal resources ([#153](https://github.com/compartmentdev/compartment/issues/153)) ([934895b](https://github.com/compartmentdev/compartment/commit/934895b950e9a12138b9f04f0dbcdd1cfb31df12))
* **api:** handle resource startup and backup state ([#189](https://github.com/compartmentdev/compartment/issues/189)) ([5a2f4e0](https://github.com/compartmentdev/compartment/commit/5a2f4e0cc290a2275fbe4f1270b08a47e17edf98))
* **api:** keep active pod metrics during rollouts ([#146](https://github.com/compartmentdev/compartment/issues/146)) ([e6b2eef](https://github.com/compartmentdev/compartment/commit/e6b2eef9e1a9c5463fcb651f44cefc62f48b91b2))
* **api:** make project teardown asynchronous and bounded ([#155](https://github.com/compartmentdev/compartment/issues/155)) ([c9a5c1d](https://github.com/compartmentdev/compartment/commit/c9a5c1d5a8448c18ef0c91de759a3f0563162601))
* **api:** make stopped reconcile revision bump atomic ([#182](https://github.com/compartmentdev/compartment/issues/182)) ([9663352](https://github.com/compartmentdev/compartment/commit/9663352bc780f9b74319a33d52e7ff0f9b69a0f4))
* **api:** prevent desired revision livelock ([#173](https://github.com/compartmentdev/compartment/issues/173)) ([6effbbb](https://github.com/compartmentdev/compartment/commit/6effbbb17fc1016c820e1e623bdada7d1deaf432))
* **api:** reject stopped manual backups ([#193](https://github.com/compartmentdev/compartment/issues/193)) ([b810ba1](https://github.com/compartmentdev/compartment/commit/b810ba1f33201a0411b136142304cb2fc467b63d))
* **api:** resquash retention migration into initial ([#166](https://github.com/compartmentdev/compartment/issues/166)) ([144c919](https://github.com/compartmentdev/compartment/commit/144c919e4b4119ab6aad7789b2b930c3b32b126c))
* **api:** restore variable reads and CLI errors ([#184](https://github.com/compartmentdev/compartment/issues/184)) ([a988abd](https://github.com/compartmentdev/compartment/commit/a988abd14ea24fa0b4e3f554b2a76a855c7682ae))
* **api:** surface deployment failure context ([#180](https://github.com/compartmentdev/compartment/issues/180)) ([03950b4](https://github.com/compartmentdev/compartment/commit/03950b4e3c223174cd18ba2c6d845db87ec87f5e))
* **api:** surface resource bootstrap conflicts ([#190](https://github.com/compartmentdev/compartment/issues/190)) ([e2ee157](https://github.com/compartmentdev/compartment/commit/e2ee157af30d469498bacd5f4a4088e260506b39))
* **api:** validate release resources before deploy ([#192](https://github.com/compartmentdev/compartment/issues/192)) ([f0f4740](https://github.com/compartmentdev/compartment/commit/f0f4740a971d0103e25aec4f0061ccf887f591d1))
* **chart:** harden platform network boundaries ([#149](https://github.com/compartmentdev/compartment/issues/149)) ([1d1bad0](https://github.com/compartmentdev/compartment/commit/1d1bad0e30fa9209863ae49a29d4ab0696dee13d))
* **ci:** pin setup-oras v2.0.1 + oras 1.3.3 for signed kubernetes CLI publish ([#156](https://github.com/compartmentdev/compartment/issues/156)) ([e056bd1](https://github.com/compartmentdev/compartment/commit/e056bd1b0f033c2986536fc57681e0f96be2d92a))
* **cli:** align deployment wait with build lifecycle ([#263](https://github.com/compartmentdev/compartment/issues/263)) ([ade677e](https://github.com/compartmentdev/compartment/commit/ade677e8e687dad4382d168a681b8fa0a67fdfb2))
* **cli:** align managed domains with main broker contract ([#238](https://github.com/compartmentdev/compartment/issues/238)) ([c5d31c3](https://github.com/compartmentdev/compartment/commit/c5d31c312e8f525a8e3b29b093b92d2484cc09f8))
* **cli:** align managed VM prerequisites ([#271](https://github.com/compartmentdev/compartment/issues/271)) ([3877aea](https://github.com/compartmentdev/compartment/commit/3877aea9b4d07ad77304825aa60ed6b843cbda84))
* **cli:** correct managed VM preflight probes ([#265](https://github.com/compartmentdev/compartment/issues/265)) ([00dcb19](https://github.com/compartmentdev/compartment/commit/00dcb1928dfb38eba794312d76a4ecedf8250c35))
* **cli:** derive operator registry hostname ([#210](https://github.com/compartmentdev/compartment/issues/210)) ([3212bb7](https://github.com/compartmentdev/compartment/commit/3212bb71288f56e0724d31bbfc2bb15ae769bc6d))
* **cli:** derive registry host from service IP ([#250](https://github.com/compartmentdev/compartment/issues/250)) ([40020b6](https://github.com/compartmentdev/compartment/commit/40020b635fc3192342b3b837e334688b4beabafb))
* **cli:** fail fast when managed domain onboarding is unavailable ([#211](https://github.com/compartmentdev/compartment/issues/211)) ([27e8e89](https://github.com/compartmentdev/compartment/commit/27e8e89aa4e75dddbd9075294760ab9b4844c59a))
* **cli:** guard malformed disk probe output ([#267](https://github.com/compartmentdev/compartment/issues/267)) ([2d3ad1e](https://github.com/compartmentdev/compartment/commit/2d3ad1e3125d87b0757fe9e7bdc7a8c7ee2fb190))
* **cli:** handle managed registry DNS propagation ([#239](https://github.com/compartmentdev/compartment/issues/239)) ([02c97b6](https://github.com/compartmentdev/compartment/commit/02c97b624c8c35fed8c60cd9c337b992340c6ac6))
* **cli:** harden install prompts and preflight errors ([#183](https://github.com/compartmentdev/compartment/issues/183)) ([b14baa7](https://github.com/compartmentdev/compartment/commit/b14baa7793582e48640801740bcbe95b9df62904))
* **cli:** harden managed VM recovery ([8cafc91](https://github.com/compartmentdev/compartment/commit/8cafc912cfeef49b589185710a51d7b8ae40564e))
* **cli:** honor fresh install input on retries ([#252](https://github.com/compartmentdev/compartment/issues/252)) ([4c9c4e9](https://github.com/compartmentdev/compartment/commit/4c9c4e9cb0730b3877afc466ba2c4f546a11dc27))
* **cli:** improve installer preflight UX ([#257](https://github.com/compartmentdev/compartment/issues/257)) ([9af1153](https://github.com/compartmentdev/compartment/commit/9af11536bff5dbf628e48ffa4d28c319cd381e3a))
* **cli:** make Kubernetes install target detection reliable ([#273](https://github.com/compartmentdev/compartment/issues/273)) ([720b92e](https://github.com/compartmentdev/compartment/commit/720b92ee243bd598a9659a1280648509fd3ff3e9))
* **cli:** make operator domain install usable ([#219](https://github.com/compartmentdev/compartment/issues/219)) ([cdecd02](https://github.com/compartmentdev/compartment/commit/cdecd02a55274b9e360892d3a5e72d968a96ea06))
* **cli:** pin Kubernetes install images and narrow restarts ([#148](https://github.com/compartmentdev/compartment/issues/148)) ([f796915](https://github.com/compartmentdev/compartment/commit/f796915a24d02d9cdacb3bfce8a499b1a81dc24c))
* **cli:** polish audit and domain commands ([#187](https://github.com/compartmentdev/compartment/issues/187)) ([8ed3bf7](https://github.com/compartmentdev/compartment/commit/8ed3bf76de1aae9c3c6213edd708787ade91b4bf))
* **cli:** polish Kubernetes, variable, and deploy UX ([#179](https://github.com/compartmentdev/compartment/issues/179)) ([a0e71e2](https://github.com/compartmentdev/compartment/commit/a0e71e2685c4c829355ff0d26a69ca45bfef2996))
* **cli:** polish scoped commands and update output ([#188](https://github.com/compartmentdev/compartment/issues/188)) ([1a810e1](https://github.com/compartmentdev/compartment/commit/1a810e1ab99b73402c2211918fa28d1f1a69b8a8))
* **cli:** preflight local Kubernetes tools ([#222](https://github.com/compartmentdev/compartment/issues/222)) ([7f9b09b](https://github.com/compartmentdev/compartment/commit/7f9b09b5455b1570b1380aa65db03fe17dd7b088))
* **cli:** preserve managed VM owner input ([#269](https://github.com/compartmentdev/compartment/issues/269)) ([e18dd00](https://github.com/compartmentdev/compartment/commit/e18dd0017363e6b0f6ddb34f3bad4fe61bf81dec))
* **cli:** protect sensitive Kubernetes diagnostics ([#225](https://github.com/compartmentdev/compartment/issues/225)) ([c0a5c7f](https://github.com/compartmentdev/compartment/commit/c0a5c7f773bef586f9419d7cd07bb6bbd5dee6bf))
* **cli:** reconcile values when resuming installs ([#227](https://github.com/compartmentdev/compartment/issues/227)) ([80700a5](https://github.com/compartmentdev/compartment/commit/80700a5ecb97a300fa1435f58717db8ebfff6c2b))
* **cli:** repair operator install experience ([#235](https://github.com/compartmentdev/compartment/issues/235)) ([b72fc1a](https://github.com/compartmentdev/compartment/commit/b72fc1a833dbfc301ab40abc37b6eee351b748af))
* **cli:** repair upgrades of existing installations ([#248](https://github.com/compartmentdev/compartment/issues/248)) ([9a57624](https://github.com/compartmentdev/compartment/commit/9a57624836791bd4bd55bc9bb315a7a0bb68ea9a))
* **cli:** restore managed broker URL default ([#232](https://github.com/compartmentdev/compartment/issues/232)) ([db8afc0](https://github.com/compartmentdev/compartment/commit/db8afc032e156c9639a5e29b6b719d39711a54bc))
* **cli:** restore managed domain self-service installs ([#229](https://github.com/compartmentdev/compartment/issues/229)) ([b60999a](https://github.com/compartmentdev/compartment/commit/b60999abba138eb5dd682b4c0cf1af4259263b05))
* **cli:** restore non-interactive activation password ([#185](https://github.com/compartmentdev/compartment/issues/185)) ([2e7b685](https://github.com/compartmentdev/compartment/commit/2e7b68527defe95a025bc87c21fc12e4b711d513))
* **cli:** restore operator domain TLS parity ([#256](https://github.com/compartmentdev/compartment/issues/256)) ([7069284](https://github.com/compartmentdev/compartment/commit/706928419a4bdf1db8a33bbb7dce13117f1a055f))
* **cli:** smooth Kubernetes install flow ([#178](https://github.com/compartmentdev/compartment/issues/178)) ([4d84140](https://github.com/compartmentdev/compartment/commit/4d84140addef604eb2b1d865de3381eef296d2e6))
* **cli:** stabilize Kubernetes CI harness ([#237](https://github.com/compartmentdev/compartment/issues/237)) ([afcbd6f](https://github.com/compartmentdev/compartment/commit/afcbd6f4290c765b424f66ba2354eeb350f989a4))
* **cli:** support kubernetes channel version pins ([#220](https://github.com/compartmentdev/compartment/issues/220)) ([7363f8f](https://github.com/compartmentdev/compartment/commit/7363f8f9203b2c09de63b38ab923518848eb0152))
* **cli:** validate operator trust prerequisites ([#224](https://github.com/compartmentdev/compartment/issues/224)) ([1e3acb9](https://github.com/compartmentdev/compartment/commit/1e3acb9c17638a05cfd3f1089982584e596395e0))
* **deploy:** raise per-project build concurrency default to 2 ([#245](https://github.com/compartmentdev/compartment/issues/245)) ([4887257](https://github.com/compartmentdev/compartment/commit/4887257005ccfe3c36a3b7277c91303ff6840333))
* **deps:** pin fast-uri 3.1.3 for CVE-2026-13676 ([#161](https://github.com/compartmentdev/compartment/issues/161)) ([5bd93e1](https://github.com/compartmentdev/compartment/commit/5bd93e117aa18af71ed8b434b56d8721e1f99e3e))
* **edge:** bump golang.org/x/text to v0.40.0 for CVE-2026-56852 ([#207](https://github.com/compartmentdev/compartment/issues/207)) ([0eefbaa](https://github.com/compartmentdev/compartment/commit/0eefbaa0ba58dba15956bfc1b46a9fa7c5d5f0ed))
* **edge:** meter gated and rate-limited hosted traffic ([#236](https://github.com/compartmentdev/compartment/issues/236)) ([efb972d](https://github.com/compartmentdev/compartment/commit/efb972d88c7cffeb6e07259bb9fad255614673b1))
* **kube-runtime:** add project namespace resource defaults ([#167](https://github.com/compartmentdev/compartment/issues/167)) ([fa320bf](https://github.com/compartmentdev/compartment/commit/fa320bf46cbd8c883c774c85c0d2b2bb7573a96d))
* **kube-runtime:** converge project and backup cleanup ([#144](https://github.com/compartmentdev/compartment/issues/144)) ([3607ae1](https://github.com/compartmentdev/compartment/commit/3607ae1af304baef0a23622af844653e7f825bcf))
* **kube-runtime:** harden reconcile, provisioning and RBAC boundaries ([#118](https://github.com/compartmentdev/compartment/issues/118)) ([6856dda](https://github.com/compartmentdev/compartment/commit/6856dda78478f2f75c04e6695ce0ad1cc7a28471))
* **kube-runtime:** preserve pod metrics during rollouts ([#142](https://github.com/compartmentdev/compartment/issues/142)) ([358467f](https://github.com/compartmentdev/compartment/commit/358467f342b79baf4d96f3b8124660b2e7b004ba))
* **kube-runtime:** reconcile declared network policy ports ([#191](https://github.com/compartmentdev/compartment/issues/191)) ([73ef40e](https://github.com/compartmentdev/compartment/commit/73ef40e87b6f29ebb54c05f12b8c63db8ad8ed8a))
* **release:** clarify bootstrap failure messages ([#228](https://github.com/compartmentdev/compartment/issues/228)) ([e246b34](https://github.com/compartmentdev/compartment/commit/e246b347157ad9a2ccbd0efc2572afdc99922c27))
* **release:** emit dns01-solver build metadata in kubernetes publish ([#203](https://github.com/compartmentdev/compartment/issues/203)) ([40ec6b9](https://github.com/compartmentdev/compartment/commit/40ec6b939f4584e69e41ee4afb2cdcf19a7195f8))
* **release:** harden stable kubernetes publishing ([#276](https://github.com/compartmentdev/compartment/issues/276)) ([1af81b7](https://github.com/compartmentdev/compartment/commit/1af81b7b3ddca54de1205ff31bc64cdacca00a7d))
* **release:** preserve registry mirror across reinstall ([#152](https://github.com/compartmentdev/compartment/issues/152)) ([3e24a80](https://github.com/compartmentdev/compartment/commit/3e24a805b24dd8d761533ddff8b97786e11371b6))
* **release:** remove post-promotion installer handoff ([#270](https://github.com/compartmentdev/compartment/issues/270)) ([60c78fa](https://github.com/compartmentdev/compartment/commit/60c78fa9e6c67ac26452349b01e5ffe0d64db51f))
* **release:** verify kubernetes public installer entry ([#230](https://github.com/compartmentdev/compartment/issues/230)) ([e0617ea](https://github.com/compartmentdev/compartment/commit/e0617ea8fc8b83502f82347573169b5d40b45523))
* **root-config:** override vulnerable find-my-way ([#186](https://github.com/compartmentdev/compartment/issues/186)) ([a41ac8b](https://github.com/compartmentdev/compartment/commit/a41ac8b3522383015cf6d7f9c5453f9e92c233b4))
* **root-config:** pin third-party infrastructure images ([#169](https://github.com/compartmentdev/compartment/issues/169)) ([6397a00](https://github.com/compartmentdev/compartment/commit/6397a007e083a95e9924141a6e74e9831f4b6c71))
* **root-config:** resume interrupted installs ([#158](https://github.com/compartmentdev/compartment/issues/158)) ([84c64fb](https://github.com/compartmentdev/compartment/commit/84c64fbbf484413953f74e9734590b8a58f8df19))
* **scripts:** avoid restarting k3d e2e nodes ([#215](https://github.com/compartmentdev/compartment/issues/215)) ([7b3b5fa](https://github.com/compartmentdev/compartment/commit/7b3b5fab7b3402c441d18a6ecace370e23bacd0a))
* **scripts:** calibrate product log backpressure gate ([#168](https://github.com/compartmentdev/compartment/issues/168)) ([8f2b70b](https://github.com/compartmentdev/compartment/commit/8f2b70b7e8b37eecd3af87a80c0917384a3358ab))
* **scripts:** close merged review debt ([#255](https://github.com/compartmentdev/compartment/issues/255)) ([878edab](https://github.com/compartmentdev/compartment/commit/878edab58a817fc46241142aa5cbeb57c2ede6d3))
* **scripts:** require scanned digests for image signing ([#151](https://github.com/compartmentdev/compartment/issues/151)) ([7308343](https://github.com/compartmentdev/compartment/commit/7308343b1fae43bc19fd6ff301ffa24d9673604d))
* **scripts:** run gVisor on one build shard ([#249](https://github.com/compartmentdev/compartment/issues/249)) ([5581404](https://github.com/compartmentdev/compartment/commit/55814049b259d48f7f6af385a812f4db8196dca7))
* **scripts:** stabilize Kubernetes publish gates ([#260](https://github.com/compartmentdev/compartment/issues/260)) ([1cfac41](https://github.com/compartmentdev/compartment/commit/1cfac417ddd8592bf44a537f2787e188b90ff2d0))
* **scripts:** wait for prerequisites after node restart ([#212](https://github.com/compartmentdev/compartment/issues/212)) ([d6fee28](https://github.com/compartmentdev/compartment/commit/d6fee28327ec878ce51bd18df1adc0b03c25939d))
* **test-support:** clean up run-scoped test databases ([#244](https://github.com/compartmentdev/compartment/issues/244)) ([a849b35](https://github.com/compartmentdev/compartment/commit/a849b353612d662886cf0a51377bb734ea663ce0))
* **worker:** gate controllers on api readiness ([#124](https://github.com/compartmentdev/compartment/issues/124)) ([ce0f814](https://github.com/compartmentdev/compartment/commit/ce0f81401f79ac063a5dc52f233e163d5a6d8f73))
* **worker:** make build runtime class optional ([#240](https://github.com/compartmentdev/compartment/issues/240)) ([d944a59](https://github.com/compartmentdev/compartment/commit/d944a59fc8ac9b8f58b554ffc2fb478ccf3e16f1))
* **worker:** preserve running jobs on transport errors ([#140](https://github.com/compartmentdev/compartment/issues/140)) ([74db1ef](https://github.com/compartmentdev/compartment/commit/74db1efc0db8e0fb010eba5c0dc951dde140ac94))
* **worker:** prevent scheduled resource failures from starving deploys ([#165](https://github.com/compartmentdev/compartment/issues/165)) ([2576389](https://github.com/compartmentdev/compartment/commit/2576389982b63d2d286b32da9d2adb21cb89d0dd))
* **worker:** reload product log agent config ([#154](https://github.com/compartmentdev/compartment/issues/154)) ([bdde064](https://github.com/compartmentdev/compartment/commit/bdde0641e760c08b78251c223afa9d2ea856b517))
* **worker:** scope pod metrics by namespace ([#145](https://github.com/compartmentdev/compartment/issues/145)) ([a5a0e56](https://github.com/compartmentdev/compartment/commit/a5a0e568c2fe2c53dc6537ac68aa6f2d63ccbb74))
* **worker:** unblock database release jobs ([#141](https://github.com/compartmentdev/compartment/issues/141)) ([e46f00a](https://github.com/compartmentdev/compartment/commit/e46f00aaf453b94e5ca4cd328a7f49d34ab63f45))

## [0.9.2](https://github.com/compartmentdev/compartment/compare/v0.9.1...v0.9.2) (2026-07-10)


### Bug Fixes

* **root-config:** update Caddy and Go security baseline ([#89](https://github.com/compartmentdev/compartment/issues/89)) ([7ebe18c](https://github.com/compartmentdev/compartment/commit/7ebe18c51ca17f998dc78b3137627d67b0336b56))

## [0.9.1](https://github.com/compartmentdev/compartment/compare/v0.9.0...v0.9.1) (2026-06-04)


### Bug Fixes

* **release:** make publish jobs immutable-safe ([#87](https://github.com/compartmentdev/compartment/issues/87)) ([141351f](https://github.com/compartmentdev/compartment/commit/141351f21bed52aebf45cdc980efcfeb11d95df7))

## [0.9.0](https://github.com/compartmentdev/compartment/compare/v0.8.0...v0.9.0) (2026-06-04)


### Features

* **console:** align action menu patterns ([#78](https://github.com/compartmentdev/compartment/issues/78)) ([b55a391](https://github.com/compartmentdev/compartment/commit/b55a391ce81c09195b4d0439d63133aa73296dfb))
* **console:** polish deployment detail pages ([#80](https://github.com/compartmentdev/compartment/issues/80)) ([278a6a7](https://github.com/compartmentdev/compartment/commit/278a6a71f0d078eac25983b45a0859986ffbd873))
* **console:** polish project overview layout ([#79](https://github.com/compartmentdev/compartment/issues/79)) ([9ebcdad](https://github.com/compartmentdev/compartment/commit/9ebcdad971a9f3da5dd11391effb314dded0d886))
* **console:** refresh console UI foundations ([#77](https://github.com/compartmentdev/compartment/issues/77)) ([84ec663](https://github.com/compartmentdev/compartment/commit/84ec663b0e82ca7a15723765c2d4c7905ba2a68b))
* **release:** add verified stable installer ([#86](https://github.com/compartmentdev/compartment/issues/86)) ([dd357d1](https://github.com/compartmentdev/compartment/commit/dd357d1f209cf4114219bb0af4bbfd3508c953eb))


### Bug Fixes

* **cli:** require Docker Engine 28 for self-hosted runtime ([#85](https://github.com/compartmentdev/compartment/issues/85)) ([c568a57](https://github.com/compartmentdev/compartment/commit/c568a572fbeabb78ed7a8436ba205076fd35577c))
* **utils:** validate self-hosted generated secrets ([#84](https://github.com/compartmentdev/compartment/issues/84)) ([b18fa3f](https://github.com/compartmentdev/compartment/commit/b18fa3fbe94131afbc88101cece70b70e1679e7a))

## [0.8.0](https://github.com/compartmentdev/compartment/compare/v0.7.0...v0.8.0) (2026-06-03)


### Features

* **node:** manage runtime network capacity ([#76](https://github.com/compartmentdev/compartment/issues/76)) ([28ac5ef](https://github.com/compartmentdev/compartment/commit/28ac5ef5a3ec3cc43f25759b95a8055c1b704217))

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
