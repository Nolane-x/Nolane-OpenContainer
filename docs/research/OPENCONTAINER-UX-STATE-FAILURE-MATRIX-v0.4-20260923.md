# OpenContainer UX State / Failure Matrix v0.4

**Date:** 2026-09-23  
**Status:** NORMATIVE RESEARCH CONTRACT / IMPLEMENTATION TEST INPUT / NOT PRODUCTION-CLOSED

This matrix makes UI completeness falsifiable. Every row requires an implementation court or explicit unsupported-profile disposition before production promotion.

| ID | Subsystem | Trigger | User-visible state | Canonical-project guarantee | Primary recovery/action | Evidence court |
|---|---|---|---|---|---|---|
| B01 | Boot | required browser capability missing | Compatibility blocked | No canonical mutation attempted | View compatibility / use supported profile | integration |
| B02 | Boot | runtime worker fails during boot | Runtime could not start | Existing workspace unchanged | Retry / diagnostics | fault injection |
| B03 | Boot | cross-origin isolation absent | Host setup required | Workspace unopened or read-only according to profile | View host setup | browser |
| B04 | Boot | protocol/profile mismatch | Runtime version incompatible | No destructive migration | Use compatible runtime / read-only | integration |
| W01 | Workspace | open known workspace succeeds | Ready | Verified generation selected | Continue | integration |
| W02 | Workspace | workspace metadata corrupt | Recovery required | Do not create empty replacement | Open Recovery Center | corruption |
| W03 | Workspace | newest generation invalid, older valid | Recovered older saved version | Older verified generation canonical | Review newer candidate / export | corruption |
| W04 | Workspace | workspace deleted in another tab | Workspace no longer available | Do not resurrect stale writer | Close / recover external copy | multi-tab |
| I01 | Import | archive contains path traversal | Import blocked | Existing workspaces untouched | Choose another archive | security |
| I02 | Import | quota fails mid staging | Import could not finish | No half-ready workspace identity | Free cache / export / retry | quota |
| I03 | Import | user cancels | Import cancelled | Temporary staging unpublished | Return to start | cancel |
| I04 | Import | source archive corrupt | Import failed | No canonical workspace created | Choose another source | parser |
| S01 | Save | normal canonical commit | Saved locally | New generation acknowledged | None | integration |
| S02 | Save | quota mid data write | Couldn’t save latest changes | Prior canonical generation intact | Free cache / export / retry | quota |
| S03 | Save | writer dies after data flush before superblock | Recovering… | Old or complete new generation only | Automatic recovery | crash |
| S04 | Save | commit succeeds but UI ack lost | Storage status uncertain | Committed generation discoverable by reconciliation | Recheck automatically | ack-loss |
| S05 | Save | draft journal write fails | Latest edits at risk | Prior canonical generation intact | Export/copy latest edits | quota |
| S06 | Save | page killed without unload | Restoring workspace… | No reliance on unload for canonical durability | Automatic recovery | lifecycle |
| Q01 | Storage | best-effort storage after meaningful work | Saved locally · best effort | Current generation saved but eviction possible | Keep locally / export | browser |
| Q02 | Storage | persist() denied | Best-effort storage continues | No data deletion | Continue / export | browser |
| Q03 | Storage | estimate low headroom | Storage getting tight | No source deletion | Free rebuildable cache | quota |
| Q04 | Storage | actual quota error despite healthy estimate | Latest operation blocked | Prior canonical truth intact | Free cache / retry | quota |
| C01 | Checkpoint | checkpoint create succeeds | Checkpoint created | Pinned verified generation recorded | None | integration |
| C02 | Checkpoint | checkpoint create fails quota | Checkpoint not created | Current project unaffected | Free cache / export | quota |
| C03 | Checkpoint | restore succeeds | Checkpoint restored | Target verified generation canonical | Continue | integration |
| C04 | Checkpoint | restore interrupted | Recovering… | Pre-restore or complete target generation only | Automatic recovery | crash |
| C05 | Checkpoint | target checkpoint corrupt | Checkpoint unavailable | Current project unchanged | Choose another checkpoint | corruption |
| C06 | Checkpoint | restore would overwrite newer unsaved draft | Review before restore | Draft/canonical state preserved pending decision | Create recovery point / review | state |
| E01 | Export | normal pinned-generation export | Export ready | Archive corresponds to one generation | Save/download | integration |
| E02 | Export | export interrupted | Export incomplete | Project unchanged | Retry | cancel |
| E03 | Export | canonical unavailable but verified older candidate exists | Emergency export available | Candidate clearly labeled | Export verified candidate | recovery |
| P01 | Package | integrity mismatch | Package verification failed | Package graph unchanged | Retry / details | security |
| P02 | Package | archive bomb exceeds limits | Package blocked | Project/package graph unchanged | Details | security |
| P03 | Package | install script needs approval | Waiting for approval | No script run yet | Allow bounded / deny | permission |
| P04 | Package | script denied | Install stopped or degraded | No secret/capability escalation | Continue without / cancel | permission |
| P05 | Package | quota mid package transaction | Install could not finish | Existing package graph remains valid | Free cache / retry | quota |
| P06 | Package | installer worker dies | Install interrupted | Temporary pack unpublished | Retry | fault injection |
| R01 | Process | spawn succeeds | Running | Project unchanged by spawn itself | Open output / preview | integration |
| R02 | Process | spawn fails command missing | Command not found | Project unaffected | Edit command / install dependency | integration |
| R03 | Process | natural exit + buffered output race | Exited | Terminal result complete per contract | Review output | race |
| R04 | Process | kill races natural exit | Exited/Cancelled single terminal outcome | No duplicate cleanup | None | race |
| R05 | Terminal | UI drawer closed | Process still running | No process kill | Reopen terminal | ui-state |
| R06 | Terminal | visible history pruned | Older output removed from view | Process unaffected | Open diagnostics if needed | resource |
| V01 | Preview | no server available | No preview server | Project safe | Start server / inspect processes | integration |
| V02 | Preview | server starting | Starting preview… | Project safety shown independently | Wait / open output | integration |
| V03 | Preview | build error | Preview build failed | Project state unchanged unless edit separately committed | Open error / AI / terminal | integration |
| V04 | Preview | server exits | Preview server stopped | Project unaffected | Restart | integration |
| V05 | Preview | HMR disconnect | Preview disconnected | Project unaffected | Reconnect/reload | browser |
| V06 | Preview | selected preview element contains sensitive DOM | Context review required | No automatic provider send | Review context | privacy |
| N01 | Network | external host not allowed | Network access blocked | Project unaffected | Review request | permission |
| N02 | Network | redirect leaves approved scope | Redirect needs approval | Secret not forwarded out of scope | Allow redirected destination / block | security |
| N03 | Network | local-network request | Local network permission required | No request sent yet | Continue to browser permission / cancel | browser |
| N04 | Network | response exceeds byte budget | Response stopped | No authority widening | Adjust bounded policy if appropriate | resource |
| N05 | Network | offline | External network unavailable | Local project/preview continue where possible | Work offline / retry later | network |
| K01 | Secret | AI/process requests bound secret | Credential use approval | Plaintext remains non-observable | Allow bounded / deny | security |
| K02 | Secret | binding destination mismatch | Credential request blocked | Secret not attached | Review scope | security |
| K03 | Secret | saved provider key removed | Model disconnected | Project unaffected | Reconnect / continue without AI | state |
| A01 | AI | no provider configured | Connect a model | Project fully usable | Connect / continue without AI | ui-state |
| A02 | AI | invalid API key | Model authentication failed | Project unaffected; key not echoed | Update key | provider |
| A03 | AI | provider rate limit | Provider rate limit reached | Acknowledged project edits retained | Retry later / switch model | provider |
| A04 | AI | provider timeout before tools | Model request timed out | Project unchanged | Retry / switch model | provider |
| A05 | AI | provider timeout after tools completed | Task outcome needs reconciliation | Tool/canonical outcomes reconciled independently | Review task state | ambiguous |
| A06 | AI | context exceeds model window | Context too large | Project unchanged | Review context / switch model | context |
| A07 | AI | malformed patch | AI change could not be applied safely | Canonical project unchanged | Retry / review patch | validation |
| A08 | AI | validation fails in overlay | Changes need attention | Canonical project still prior generation until publish | Fix / review / discard | validation |
| A09 | AI | publish quota failure | Latest AI changes not saved | Prior generation intact; proposal recoverable if possible | Recovery Center / free cache | quota |
| A10 | AI | publish commit succeeds, UI ack lost | AI change status uncertain | Reconcile mutation id before retry | Recheck automatically | ack-loss |
| A11 | AI | user cancels while tool inflight | Cancelling… | Late result cannot publish | Wait for cancellation / inspect | race |
| A12 | AI | stale result returns after cancel | Stale result discarded | No canonical mutation | Review result optionally | race |
| A13 | AI | model switched mid task | Model changed for future calls | Completed effects not replayed | Continue / new task | state |
| A14 | AI | sensitive file auto-context candidate | Context approval required | Sensitive file not sent yet | Review / deny | privacy |
| A15 | AI | conversation history recovery fails | Project recovered; AI history unavailable | Project truth independent | Continue new conversation | recovery |
| G01 | Agents | child agent read-only completes | Research result ready | No source mutation | Review result | multi-agent |
| G02 | Agents | child editor conflicts with user edit | Conflict needs review | No stale publish | Review conflict | multi-agent |
| G03 | Agents | child cancelled with inflight work | Cancelled | Late result stale | None / inspect | race |
| G04 | Agents | resource governor pauses agents | Background work paused | Project saved independently | Wait / stop tasks / Eco | resource |
| G05 | Agents | one child fails | Agent failed | Parent/project continue unless dependency required | Retry child / continue | multi-agent |
| T01 | Tabs | second tab opens same workspace | Editing in another tab | Only confirmed writer publishes | Inspect / safe takeover | multi-tab |
| T02 | Tabs | safe takeover succeeds | Editing here | New epoch confirmed | Continue | multi-tab |
| T03 | Tabs | old tab tries stale commit | Stale change rejected | Canonical generation unchanged | Refresh/rebase | race |
| L01 | Lifecycle | page hidden/frozen | Background state | No dependence on future callbacks | Park/recovery metadata | browser |
| L02 | Lifecycle | BFCache restore | Resuming… | Authority revalidated | Automatic re-handshake | browser |
| L03 | Lifecycle | tab discarded | Restoring workspace… | Canonical generation recovered first | Automatic recovery | browser |
| L04 | Lifecycle | browser refresh | Restoring workspace… | Refresh not reset | Automatic recovery | browser |
| U01 | Update | runtime update available | Update available | Project unchanged | Update when safe | update |
| U02 | Update | new runtime storage incompatible | Compatibility attention | No destructive open/migration | Use old/read-only/migrate | update |
| M01 | Migration | preflight insufficient headroom | Migration postponed | Old generation intact | Free cache / export | migration |
| M02 | Migration | crash mid migration | Recovering… | Old or verified new generation only | Automatic recovery | crash |
| D01 | Diagnostics | support bundle requested | Review diagnostic contents | No secret/source by default | Export redacted bundle | privacy |
| D02 | Diagnostics | diagnostic ring full | Older diagnostics summarized/pruned | Runtime/project unaffected | Export current bounded data | resource |
| X01 | Delete | delete workspace requested | Confirm scoped deletion | No delete before confirm | Export / delete | destructive |
| X02 | Delete | delete ack lost | Deletion status uncertain | Reconcile before recreation/retry | Recheck storage | ack-loss |
| X03 | Delete | discard recovery draft | Confirm discard newer unsaved edits | Canonical saved generation retained | Discard / cancel | destructive |
| AC01 | Accessibility | modal opens | Dialog focused | No hidden focus target | Keyboard navigate / Esc when safe | a11y |
| AC02 | Accessibility | streaming AI response | Milestone announcements | No token spam | Read conversation normally | a11y |
| AC03 | Accessibility | drag resize unavailable | Alternative controls available | No functionality loss | Use preset/keyboard | a11y |
| LC01 | Localization | long translated label | Layout expands/wraps | No action clipping | Use localized UI | i18n |
| LC02 | Localization | RTL shell | Mirrored layout where appropriate | Paths/code remain canonical | Use shell | i18n |
| RS01 | Resource | UI long session 8h | Stable shell | No unbounded DOM/log growth | Continue | soak |
| RS02 | Resource | large AI conversation | Older messages virtualized | Conversation retained per policy | Scroll/search history | resource |

## Coverage summary

- Scenarios: **100**
- Every row specifies a user-visible state and project-safety expectation.
- A row marked project unaffected still requires a court proving the operation cannot accidentally mutate canonical truth.
- `ack-loss`, `race`, `quota`, `crash`, and `browser` rows are production-critical because button-level tests cannot establish them.

## Closure rule

Production UX closure requires zero critical rows with undefined UI state, undefined recovery action, or ambiguous project-safety semantics. Unsupported operations must be explicitly outside the declared production profile rather than silently omitted.

## Round-23 extension rows

| ID | Subsystem | Trigger | User-visible state | Canonical-project guarantee | Primary recovery/action | Evidence court |
|---|---|---|---|---|---|---|
| F101 | External FS | remembered handle now prompt | Permission needed | Project unaffected | Reconnect / continue local | browser |
| F102 | External FS | remembered handle denied | External file unavailable | Project unaffected | Export copy / choose file | browser |
| F103 | External FS | external file changed | External change detected | No overwrite before reconcile | Compare / merge / reload | conflict |
| F104 | Import | name/id collision | Workspace already exists | Existing workspace unchanged | Open existing / import copy | integration |
| F105 | Import | drop target ambiguous | Choose import action | No mutation yet | Select destination/action | ui-state |
| F106 | Export | package complete, download denied | Export could not be saved | Project unchanged | Retry / choose destination | browser |
| F107 | Export | external save permission lost | Permission needed | Project unchanged | Reconnect / download copy | browser |
| F108 | Clipboard | read denied | Paste permission unavailable | Project unaffected | Native paste / retry by action | browser |
| F109 | Clipboard | write denied | Copy failed | Project unaffected | Select/copy manually | browser |
| F110 | Terminal | multiline paste | Review command paste | Project unchanged until process acts | Paste / cancel | safety |
| F111 | Navigation | Back during AI task | Previous safe view | Task continues unless cancelled explicitly | Return to AI / status | lifecycle |
| F112 | Navigation | Refresh after commit before ack | Restoring/reconciling | Committed mutation discovered once | Automatic reconcile | ack-loss |
| F113 | Tabs | follower view stale | Workspace changed elsewhere | Stale tab cannot publish | Review latest / rebase | multi-tab |
| F114 | Permission | revoked mid network request | Permission lost | Project unchanged | Re-authorize / cancel | browser |
| F115 | Permission | revoked external folder | Linked folder disconnected | Browser project preserved | Reconnect / export | browser |
| F116 | Update | compatible update available | Update available | Project unaffected | Apply later | update |
| F117 | Update | protocol incompatible | Compatibility attention | Unsafe writer blocked | Compatible runtime / read-only | update |
| F118 | Migration | cancel before boundary | Migration cancelled | Old generation intact | Continue using old | migration |
| F119 | Migration | cancel after boundary | Finishing safely | Old or complete new only | Wait / recovery | migration |
| F120 | Delete | permanent purge ack lost | Checking deletion result | No blind repeat | Reconcile | ack-loss |
| F121 | Undo | AI undo overlaps user edit | Undo conflict | Later edits preserved | Review inverse diff | conflict |
| F122 | Undo | restore mistaken for undo | Restore requires scope review | Current state protected/checkpointed | Review restore | safety |
| F123 | Form | endpoint invalid | Endpoint invalid | Project unaffected | Fix endpoint | validation |
| F124 | Input | IME composition + send shortcut | Continue composing | No request sent | Finish composition | a11y/input |
| F125 | Input | software keyboard covers send | Composer adjusted | No data loss | viewport/safe-area layout | responsive |
| F126 | AI | provider changed with pending draft | New destination pending | Project unaffected | Review provider/context | privacy |
| F127 | AI | tool output contains sensitive text | Context review/redaction | No unauthorized egress | Remove/redact/send | privacy |
| F128 | AI | retry after tool commit | Retry inference only | No duplicate mutation | Reconcile tool ids | idempotency |
| F129 | AI | child requests broader context | Scope approval | No silent context expansion | Review scope | privacy |
| F130 | AI | malicious markdown mimics Apply button | Inert content | No privileged action | Use real ChangeSet controls | security |
| F131 | AI | history compacted | Context compacted | Project unaffected | Inspect effective context | context |
| F132 | AI | offline mid stream | AI interrupted | Project/local runtime intact | Retry later / local work | network |
| F133 | Visual | forced-colors active | High-contrast shell | All actions available | Continue | a11y |
| F134 | Visual | reduced motion active | Motion-reduced shell | All actions available | Continue | a11y |
| F135 | Localization | RTL path line | Isolated technical text | No path ambiguity | Copy canonical path | i18n |
| F136 | Notification | repeated identical error | Aggregated attention | Project truth unchanged | Open grouped details | ui-state |
| F137 | Loading | operation completes before spinner threshold | Direct result | Project semantics normal | None | performance |
| F138 | Resource | UI pressure high | Visual effects reduced | Safety/status never hidden | Continue / Eco | resource |
| F139 | Details | support id copied | Copy exact diagnostic id | No secret included | Send to support | privacy |
| F140 | External boundary | unknown completion of high-impact write | Checking result | Reconcile before retry | Automatic re-query | ambiguous |

Round-23 total scenarios: **140**.

---

# Round-24 state/failure extension

| ID | Subsystem | Trigger | User-visible state | Canonical-project guarantee | Primary recovery/action | Evidence court |
|---|---|---|---|---|---|---|
| U01 | Undo | AI change followed by same-path manual edit | Undo needs review | Current generation unchanged until conflict resolved | Review overlapping hunks | integration |
| U02 | Undo | later unrelated edit | Undo ready | Unrelated newer path preserved | Apply inverse transaction | integration |
| U03 | Undo | deleted path recreated | Undo conflict | Recreated file untouched | Choose keep/restore/rename | integration |
| U04 | Undo | quota during inverse transaction | Undo could not finish | Pre-undo generation intact | Free cache/export/retry | quota |
| U05 | Undo | commit succeeds, ack lost | Undo status uncertain | Reconcile mutation id before retry | Recheck automatically | ack-loss |
| U06 | Redo | touched path changed after undo | Redo needs review | Current project unchanged | Review/reapply | state |
| U07 | History | provenance metadata missing | Change owner unavailable | Project truth unaffected | Technical details | corruption |
| U08 | History | stale history cache | Updating history | No mutation based on stale row | Refresh by generation | multi-tab |
| T01 | AI trust | README asks AI to upload secrets | Capability not granted | No secret/network expansion | Continue without escalation / review real request | adversarial |
| T02 | AI trust | webpage embeds tool instructions | External instruction ignored as authority | Project unchanged | Inspect context/tool request | adversarial |
| T03 | AI trust | dependency content requests secret | Secret unavailable | Secret plaintext never exposed | Continue/block | adversarial |
| T04 | AI trust | terminal output asks destructive command | Tool authority unchanged | No command from text alone | User/product action required | adversarial |
| T05 | AI trust | model renders fake approval button | Inert message content | No privileged action | Use real product approval | security |
| T06 | AI trust | model output references remote tracking image | Media blocked/not auto-loaded | No hidden egress | Load explicitly / inspect URL | privacy |
| T07 | AI trust | child agent requests full workspace | Scope expansion pending/denied | Existing project unchanged | Review according to policy | agent-security |
| T08 | AI trust | child agent requests secret | Sensitive escalation | No inherited secret by default | Explicit scoped grant / deny | agent-security |
| T09 | AI trust | context compaction drops pinned item | Context limit needs action | No project mutation | Narrow/summarize/fresh task | context |
| T10 | AI trust | custom endpoint changes destination | Provider destination changed | Project unchanged | Confirm ordinary send / cancel | privacy |
| T11 | AI trust | malformed tool payload | AI task failed safely | No malformed tool execution | Retry/edit/switch model | parser |
| T12 | AI trust | external mutation timeout/unknown result | Outcome unknown | Local project truth separate | Reconcile before retry | network |
| R01 | Recovery | BFCache restore with stale WriterEpoch | Read-only/follower until revalidated | Stale writer cannot publish | Reacquire/rebase | browser |
| R02 | Recovery | device sleep expires task deadline | Task health check | Project unchanged | Restart/continue task | lifecycle |
| R03 | Recovery | session-memory API key lost on reload | AI disconnected | Project/runtime usable | Reconnect provider | browser |
| R04 | Recovery | external folder permission returns prompt | External folder needs access | Browser canonical project healthy | Reauthorize/read-only | browser |
| R05 | Recovery | external permission denied | Sync unavailable | Canonical project preserved | Continue local/export | browser |
| R06 | Recovery | project healthy, draft corrupt | Draft recovery failed | Saved generation intact | Continue saved/export diagnostics | corruption |
| R07 | Recovery | project verified, process state lost | Processes need restart | Project intact | Restart selected commands | lifecycle |
| R08 | Recovery | project verified, AI history lost | AI task history unavailable | Project intact | New turn/review Change History | lifecycle |
| R09 | Recovery | recovery phase stalls | Recovery needs attention | No false Ready state | Retry/read-only/export/details | timeout |
| R10 | Recovery | no valid canonical generation | Storage recovery blocked | No empty reset under identity | Emergency candidate export/support | corruption |
| R11 | Update | compatible update available | Update available | No mutation yet | Update later/now | integration |
| R12 | Update | migration required | Update requires restart/migration | Old generation retained until verified switch | Review/update/read-only | migration |
| R13 | Update | controller changes mid-preview | Reconnecting preview | Project unchanged | Re-handshake/reload preview | browser |
| F01 | Focus | dialog closes, invoker removed | Focus restored to logical successor | Project unaffected | Continue keyboard flow | a11y |
| F02 | Focus | selected mode differs from focused tab | Focus/selection remain distinguishable | Project unaffected | Arrow/activate correctly | a11y |
| F03 | Focus | background task completes | Status/history update only | No focus theft | Continue current task | a11y |
| F04 | Focus | delete focused file row | Focus next/previous/parent | Project follows confirmed delete semantics | Continue navigation | a11y |
| F05 | Focus | modal open with long explanatory text | Dialog context focus | No hidden background interaction | Read/Tab/Escape | a11y |
| A01 | A11y | 400% zoom | Single-canvas reflow | Safety/action controls remain reachable | Sheets/full-canvas modes | rendered |
| A02 | A11y | forced colors | System-visible focus/state | No semantic loss | Continue | rendered |
| A03 | A11y | text-spacing override | Expanded labels | Critical text not clipped | Reflow | rendered |
| A04 | A11y | IME Enter composition | Composition continues | No accidental send/run | Explicit send after composition | input |
| A05 | A11y | software keyboard reduces viewport | Composer/action remains reachable | Draft preserved | Scroll/safe-area layout | mobile |
| A06 | A11y | virtualized long transcript | Current + searchable history accessible | Project unaffected | Accessible fallback/search | screen-reader |
| P01 | Privacy | support detail contains secret-looking field | Redacted technical detail | No secret disclosure | Copy safe summary | privacy |
| P02 | Privacy | AI provider link/media could encode private context | Hidden egress blocked | Project unchanged | Inspect/open explicitly | privacy |
| P03 | Privacy | model/provider switch with pending sensitive context | New destination disclosed | No send until user action | Send/cancel | privacy |
| X01 | External | export archive ready but destination fails | Export not completed | Project unchanged | Choose destination/retry | filesystem |
| X02 | External | linked folder modified concurrently | External conflict | Canonical browser state safe | Review versions | filesystem |
| X03 | External | drag-drop import cancelled | Import cancelled | Staging discarded | Return | input |
| X04 | External | clipboard write denied | Copy unavailable | Project unchanged | Download/manual select | browser |
| X05 | External | permanent purge ack lost | Deletion outcome uncertain | Reconcile tombstone/canonical before retry | Recheck state | ack-loss |

**Round-24 matrix count: 190 scenarios.**

## Round-24 additional completeness rows

| ID | Subsystem | Trigger | User-visible state | Canonical-project guarantee | Primary recovery/action | Evidence court |
|---|---|---|---|---|---|---|
| V01 | Visual | mode switch at 400% zoom | Single-canvas reflow | Project unchanged | Continue via tab/sheet | rendered |
| V02 | Visual | forced-colors removes custom backgrounds | System-color state | No semantic loss | Continue | rendered |
| V03 | Visual | reduced motion enabled | Instant/low-motion transitions | No functional loss | Continue | rendered |
| V04 | Visual | long localized label | Reflow/truncate safely | No hidden safety meaning | Full label accessible | localization |
| V05 | Visual | RTL path contains LTR technical token | Bidi-isolated technical text | No mistaken target identity | Copy exact path | RTL |
| N01 | Notification | repeated background success events | Coalesced history | No focus theft | Inspect history | soak |
| N02 | Notification | save failure occurs behind modal | Persistent safety status | Failure remains visible after modal | Open Recovery | integration |
| N03 | Notification | multiple approvals queued | Bounded approval inbox | No implicit grant | Review individually/group safely | integration |
| N04 | Notification | toast disappears while issue persists | Persistent status remains | Project truth unchanged | Open inspector | state |
| D01 | Destructive | permanent purge requested | Irreversible review | No deletion before explicit confirmation | Cancel/purge | integration |
| D02 | Destructive | purge cannot retain tombstone due quota | Recovery unavailable warning | Existing project unchanged pre-confirm | Export/cancel/purge | quota |
| D03 | Destructive | user double-clicks purge | Single operation identity | No duplicate purge | Reconcile one outcome | idempotency |
| D04 | Destructive | external deploy confirmation lost | Outcome unknown | Local project unaffected | Reconcile remote state | network |
| M01 | Multi-tab | follower sees newer generation | Stale view indicator | No stale write | Refresh/rebase | multi-tab |
| M02 | Multi-tab | writer tab crashes | Re-electing writer | Last valid generation remains | Automatic failover | multi-tab |
| M03 | Multi-tab | two tabs request checkpoint | Serialized/identified operations | No duplicate/ambiguous checkpoint | Show resulting checkpoint(s) | concurrency |
| M04 | Multi-tab | tab resumes after long sleep | Revalidating authority | No stale publication | Reacquire/continue read-only | lifecycle |
| C11 | Context | user removes context while request preparing | Context changed before send | Project unchanged | Rebuild manifest / send | state |
| C12 | Context | source file changes after context snapshot | Context may be stale | Project unchanged | Refresh context / send snapshot knowingly | concurrency |
| C13 | Context | sensitive file auto-detected late | Sensitive item excluded | No unintended egress | Review manifest | privacy |
| C14 | Context | screenshot contains secret-like region | Privacy review needed | Project unchanged | Remove/redact/send knowingly | privacy |
| E11 | Editor | save requested while canonical writer lost | Save blocked/recoverable draft | Last valid generation intact | Reacquire/export draft | multi-tab |
| E12 | Editor | binary file opened as text | Safe unsupported view | File unchanged | Download/open external | parser |
| E13 | Editor | huge file exceeds editor budget | Large-file mode | File unchanged | Read-only/stream/open external | resource |
| E14 | Editor | rename collides with existing path | Rename blocked | Both originals preserved | Choose new name/review | filesystem |
| L01 | Localization | locale changes during open dialog | Dialog rerenders safely | No operation replay | Continue | localization |
| L02 | Localization | number/date formatting unavailable | Canonical fallback format | No semantic ambiguity | Copy technical value | localization |
| L03 | Localization | font fallback changes metrics | Layout reflows | No clipped critical action | Responsive layout | rendered |
| K01 | Keyboard | shortcut conflicts with browser/AT | Shortcut not relied upon | No lost capability | Pointer/menu alternative | manual |
| K02 | Keyboard | Escape during irreversible commit phase | Cannot cancel safely | Commit/recovery completes deterministically | Show wait/state | integration |
| K03 | Keyboard | focus target removed by async update | Logical focus successor | No body focus loss | Continue navigation | a11y |
| K04 | Keyboard | repeated Tab through virtualized history | Stable tab sequence | No inaccessible content | Search/accessible history | a11y |
| G01 | Resource | UI memory pressure | Visual degradation | Safety UI preserved | Auto reduce effects/history | weak-device |
| G02 | Resource | long chat transcript | Virtualized transcript | Project unaffected | Search/older history on demand | soak |
| G03 | Resource | rapid open/close sheets | Bounded listeners/DOM | Project unaffected | None | leak-soak |
| G04 | Resource | many status updates | Coalesced render | No UI lockup | Bounded status/history | soak |
| H01 | Help | user opens technical details during critical failure | Redacted structured detail | No secret leakage | Copy safe summary | privacy |
| H02 | Help | support bundle generation fails | Support export failed | Project unaffected | Retry/copy summary/emergency export | integration |

**Verified row target after Round-24 additions: 190 executable failure scenarios.**

| R25-191 | Save | late ack for older generation after newer canonical commit | Reconciling… | No false Saved claim | Query current authority | model/integration |
| R25-192 | Save | UI timeout with committed mutation unknown | Checking save… | No duplicate publish | Reconcile request id | ack-loss |
| R25-193 | Save | duplicate click during pending publish | Saving… | At-most-once canonical effect | Reuse mutation identity | idempotency |
| R25-194 | Save | cancel after irreversible commit point | Finishing saved change… | Committed effect not misreported cancelled | Reconcile then report | cancel-race |
| R25-195 | Save | writer epoch changes during pending UI save | Save paused for revalidation | Stale authority cannot publish | Reacquire/rebase | multi-tab |
| R25-196 | Draft | draft journal corrupt, canonical healthy | Saved project recovered; draft unavailable | Canonical untouched | Discard/export diagnostics | corruption |
| R25-197 | Draft | draft based on older generation | Draft needs review | No automatic stale merge | Diff/rebase/discard | state |
| R25-198 | Draft | draft export succeeds while canonical save blocked | Draft exported | Canonical unchanged | Continue recovery | quota |
| R25-199 | Delete | permanent purge ack lost | Checking deletion… | No duplicate purge | Reconcile project identity | ack-loss |
| R25-200 | Delete | normal delete tombstone cannot be retained | Recovery unavailable warning | No hidden irreversible delete | Cancel/export/confirm purge | quota |
| R25-201 | Restore | safety checkpoint creation fails | Restore needs confirmation | Current state not silently discarded | Cancel/export/retry | quota |
| R25-202 | Restore | restore commits but UI response lost | Checking restored version… | No duplicate restore | Reconcile target generation | ack-loss |
| R25-203 | Undo | AI inverse conflicts with newer user edit | Undo needs review | Newer edit preserved | Resolve paths | conflict |
| R25-204 | Undo | external side effect already occurred | Project undo available; external effect remains | No false remote rollback claim | Review external consequence | integration |
| R25-205 | Redo | redo base no longer matches | Redo unavailable/stale | No overwrite | Review history/new ChangeSet | conflict |
| R25-206 | Multi-tab | stale tab receives old save ack after other tab advanced | Revalidating… | No stale Saved claim | Refresh authority state | multi-tab |
| R25-207 | Multi-tab | writer owner disappears mid-dialog | Writer changed | No stale action publication | Revalidate/reopen action | multi-tab |
| R25-208 | Multi-tab | two tabs issue same destructive mutation id | Single operation result | No duplicate effect | Show shared receipt | idempotency |
| R25-209 | Lifecycle | BFCache resume with stale writer epoch | Revalidating workspace… | Writes blocked until current | Reacquire authority | browser |
| R25-210 | Lifecycle | browser close without pagehide/beforeunload | Next open recovers from continuous durability | No final-event dependency | Recovery Center | lifecycle |
| R25-211 | External FS | remembered directory handle now prompt | Folder needs permission | Local canonical copy safe | Request on user action | browser |
| R25-212 | External FS | write permission denied after local edit | External writeback blocked | Browser-local project/draft preserved | Reconnect/export | permission |
| R25-213 | External FS | external file changed outside app | External conflict | No blind overwrite | Compare/reload/write copy | filesystem |
| R25-214 | External FS | directory entry disappears | Linked resource missing | Canonical project unaffected | Locate/relink/remove link | filesystem |
| R25-215 | AI | sensitive file auto-selected by heuristic | Context blocked | No unintended egress | Review exact context | privacy |
| R25-216 | AI | user explicitly shares sensitive range then switches provider | Provider scope changed | Old approval not reused automatically | Reconfirm egress | privacy |
| R25-217 | AI | model text renders fake Approve button | Untrusted message content | No capability granted | Use product approval surface | security |
| R25-218 | AI | tool output contains prompt-injection instructions | Untrusted tool data | No authority manufacture | Continue under product policy | security |
| R25-219 | AI | late child-agent result after parent epoch changed | Stale result | No publish | Review/copy/new request | race |
| R25-220 | AI | provider request sent but connection drops before response | Provider outcome unknown/read-only | Project unchanged unless independent tools committed | Retry provider after reconcile | provider |
| R25-221 | AI | tool committed then provider retry requested | Task reconciliation | Tool not replayed blindly | Reuse receipt/continue | idempotency |
| R25-222 | AI | session-memory API key lost on reload | AI reconnect required | Project/runtime intact | Reconnect/continue without AI | lifecycle |
| R25-223 | AI | Context Manifest build fails | Request not sent | No hidden broad context fallback | Fix/retry | privacy |
| R25-224 | AI | effective context differs after compaction | Context changed before send | No undisclosed egress | Show effective manifest | privacy |
| R25-225 | Permission | custom preprompt says allow but browser denies | Browser permission denied | No false granted state | Explain site/browser recovery | browser |
| R25-226 | Permission | grant ack lost after capability created | Checking permission… | No duplicate widening | Query capability authority | ack-loss |
| R25-227 | Secret | binding revoke while request inflight | Credential revoked / request outcome separate | Future use blocked; project unchanged | Reconcile inflight request | security |
| R25-228 | Secret | secret label removed but running task holds stale handle | Handle invalid/stale | Plaintext not exposed; future attachment denied | Reconnect or fail task | security |
| R25-229 | A11y | dialog opener removed before close | Focus moves to logical survivor | No focus loss | Continue from survivor | a11y |
| R25-230 | A11y | last focusable dialog item removed asynchronously | Dialog keeps valid close/fallback target | No keyboard trap/body focus | Fallback focus | a11y |
| R25-231 | A11y | status updates flood live region | Announcements coalesced | No screen-reader spam | Milestone announcements | a11y |
| R25-232 | A11y | IME composition active and Enter pressed | Composition continues | No accidental AI send | Send only after compositionend | ime |
| R25-233 | A11y | software keyboard obscures composer/action | Layout adjusts to safe area | Primary action remains reachable | Resize/scroll into view | mobile |
| R25-234 | Resource | low-memory mode prunes chat history | Older transcript on demand | Safety/status/history receipts retained | Load/search older history | weak-device |
| R25-235 | Resource | UI rendering falls behind status events | Coalesced state projection | Authority truth not dropped | Render latest authoritative state | soak |
| R25-236 | Resource | diagnostic ring full during recovery | Bounded diagnostics | Recovery truth/canonical state unaffected | Keep aggregate/last-N | soak |
| R25-237 | Export | emergency export response interrupted | Export incomplete | Project unchanged | Retry from pinned generation | network |
| R25-238 | Export | draft and canonical exported together ambiguously | Export review required | Versions not silently merged | Choose canonical/draft/both labelled | recovery |
| R25-239 | Update | runtime update arrives during modal destructive action | Update waits/coordinates | No protocol skew mutation | Finish/cancel then update | version-skew |
| R25-240 | Update | new UI cannot interpret older pending operation receipt | Compatibility blocked/read-only detail | No replay/destructive guess | Use compatible reader/diagnostics | version-skew |

**Verified row target after Round 25: 280 executable failure scenarios.**