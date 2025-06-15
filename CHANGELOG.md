# Changelog
All notable changes to this project will be documented in this file.

# [unreleased] - 2025-xx-xx
### replaced the pump module with the newer stream pipe to support newer nodejs versions natively

# [16.3.1] - 2025-03-30
### added setMessageReaction - [#407](https://github.com/windkh/node-red-contrib-telegrambot/issues/407) 

# [16.3.0] - 2025-03-05
### added setMessageReaction - [#404](https://github.com/windkh/node-red-contrib-telegrambot/issues/404) 

# [16.2.0] - 2025-02-08
### fixed previous commit - [#402](https://github.com/windkh/node-red-contrib-telegrambot/issues/402) 

# [16.1.3] - 2025-01-08
### webhook local listening host is now configurable - [#396](https://github.com/windkh/node-red-contrib-telegrambot/issues/396) 

# [16.1.2] - 2025-01-08
### webhook url parsing improved - [#398](https://github.com/windkh/node-red-contrib-telegrambot/issues/398) 

# [16.1.1] - 2024-09-29
### IP address family any is 0 now - [#343](https://github.com/windkh/node-red-contrib-telegrambot/issues/343) 

# [16.1.0] - 2024-09-15
### IP address family can be configured now - [#343](https://github.com/windkh/node-red-contrib-telegrambot/issues/343) 

# [16.0.2] - 2024-07-02
### tried to fix unhandled exception in sender node - [#377](https://github.com/windkh/node-red-contrib-telegrambot/issues/377) 

# [16.0.1] - 2024-06-22
### fixed getFile typo - [#381](https://github.com/windkh/node-red-contrib-telegrambot/issues/381) 

# [16.0.0] - 2024-06-21
### updated to 0.66.0, removed dependencies to deprecated request, updated sock agent

# [15.1.11] - 2024-06-20
### added option for enabling test environment - [#380](https://github.com/windkh/node-red-contrib-telegrambot/issues/380) 

# [15.1.9] - 2024-01-30
### Added full weblink in response message of getfile. 
- see also - [#357](https://github.com/windkh/node-red-contrib-telegrambot/pull/357) 

# [15.1.8] - 2024-01-14
### added setChatAdministratorCustomTitle - [#351](https://github.com/windkh/node-red-contrib-telegrambot/issues/351) 

# [15.1.7] - 2023-08-29
### answerCallbackQuery text is now optional - [#339](https://github.com/windkh/node-red-contrib-telegrambot/issues/339) 

# [15.1.6] - 2023-08-29
### stopPoll added - [#331](https://github.com/windkh/node-red-contrib-telegrambot/issues/331) 

# [15.1.5] - 2023-08-29
### fixed dark theme - [#332](https://github.com/windkh/node-red-contrib-telegrambot/issues/332) 

# [15.1.4] - 2023-06-20
### control node can execute commands - [#315](https://github.com/windkh/node-red-contrib-telegrambot/issues/315) 

# [15.1.3] - 2023-06-13
### added chat_id in options - [#306](https://github.com/windkh/node-red-contrib-telegrambot/issues/306) 

# [15.1.2] - 2023-06-12
### fixed unauthorized calls in event node - [#314](https://github.com/windkh/node-red-contrib-telegrambot/issues/314) 

# [15.1.1] - 2023-04-29
### fixed port conflict in webhook mode - [#303](https://github.com/windkh/node-red-contrib-telegrambot/issues/303) 

# [15.1.0] - 2023-04-15
### fixed sendInvoice: startParameter removed - [#302](https://github.com/windkh/node-red-contrib-telegrambot/issues/302) 

# [15.0.1] - 2023-01-24
### improved doc - [#289](https://github.com/windkh/node-red-contrib-telegrambot/issues/289) 
### improved doc - [#290](https://github.com/windkh/node-red-contrib-telegrambot/issues/290) 

# [14.9.1] - 2022-11-13
### updated to 0.60.0 - [#281](https://github.com/windkh/node-red-contrib-telegrambot/issues/281) 

# [14.8.7] - 2022-10-23
### fixed config of control node - [#253](https://github.com/windkh/node-red-contrib-telegrambot/issues/253) 

# [14.8.6] - 2022-10-19
### reworked offline detection in control node - [#253](https://github.com/windkh/node-red-contrib-telegrambot/issues/253) 

# [14.8.5] - 2022-10-19
### added getfile - [#252](https://github.com/windkh/node-red-contrib-telegrambot/issues/252) 

# [14.8.4] - 2022-10-19
### fixed answerCallbackQuery - [#278](https://github.com/windkh/node-red-contrib-telegrambot/issues/278) 

# [14.8.3] - 2022-10-19
### fixed editmessagemedia - [#277](https://github.com/windkh/node-red-contrib-telegrambot/issues/277) 

# [14.8.1] - 2022-10-18
### replaced performance.now - [#276](https://github.com/windkh/node-red-contrib-telegrambot/issues/276) 

# [14.8.0] - 2022-10-17
### control node has second output now

# [14.7.0] - 2022-10-16
### control node sends a msg on every poll cycle

# [14.6.0] - 2022-10-15
### fixed: when changing socks5 hostname you had to redeploy - [#265](https://github.com/windkh/node-red-contrib-telegrambot/issues/265) 

# [14.5.0] - 2022-10-15
### added control node - [#228](https://github.com/windkh/node-red-contrib-telegrambot/issues/228) 

# [14.4.0] - 2022-10-14
### fileName can be specified when downloading file - [#275](https://github.com/windkh/node-red-contrib-telegrambot/issues/275) 

# [14.3.0] - 2022-09-20
### improved deuplicate token usage detection - [#272](https://github.com/windkh/node-red-contrib-telegrambot/issues/272) 

# [14.2.0] - 2022-09-19
### Made node more robust when initialization is aborted due to duplicate token usage - [#272](https://github.com/windkh/node-red-contrib-telegrambot/issues/272) 

# [14.1.0] - 2022-09-01
### Added web app data support - [#264](https://github.com/windkh/node-red-contrib-telegrambot/issues/264) 

# [14.0.0] - 2022-08-29
### fixed version 12.0.0 where SOCKS was broken - [#263](https://github.com/windkh/node-red-contrib-telegrambot/issues/263) 

# [13.2.0] - 2022-08-28
### Tried to improved error handling when network disconnects. 

# [13.1.0] - 2022-08-28
### added check during startup to avoid that the token is used twice.

# [13.0.0] - 2022-08-28
### breaking change in answerCallbackQuery: options is now an object - [#266](https://github.com/windkh/node-red-contrib-telegrambot/issues/266) 

# [12.0.0] - 2022-07-17
### upgraded socks-proxy-agent to 7.0 - [#260](https://github.com/windkh/node-red-contrib-telegrambot/issues/260) 

# [11.8.0] - 2022-07-17
### fixed - [#242](https://github.com/windkh/node-red-contrib-telegrambot/issues/242) 

# [11.7.0] - 2022-07-17
### fixed - [#258](https://github.com/windkh/node-red-contrib-telegrambot/issues/258) 
### fixed - [#258](https://github.com/windkh/node-red-contrib-telegrambot/issues/259) 

# [11.6.0] - 2022-06-28
### added download file by fileId feature - [#252](https://github.com/windkh/node-red-contrib-telegrambot/issues/252) 

# [11.5.0] - 2022-06-28
### upgraded to node-telegram-bot-api to 0.58.0, added explicit dependency to request: see [#247](https://github.com/windkh/node-red-contrib-telegrambot/issues/247)
### fixed [#249](https://github.com/windkh/node-red-contrib-telegrambot/issues249) 
### fixed [#250](https://github.com/windkh/node-red-contrib-telegrambot/issues/250) 

# [11.4.0] - 2022-05-16
### added added approveChatJoinRequest, declineChatJoinRequest - [#245](https://github.com/windkh/node-red-contrib-telegrambot/issues/245) 

# [11.3.0] - 2022-04-07
### sendDice added - [#238](https://github.com/windkh/node-red-contrib-telegrambot/issues/238) 

# [11.2.4] - 2022-02-13
### removed version properties from package.json - [#235](https://github.com/windkh/node-red-contrib-telegrambot/issues/235)

# [11.2.3] - 2022-02-03
### allowed node-red 1.3.7 and nodejs 12.0.0

# [11.2.2] - 2022-02-03
### allowed node-red 1.0 and nodejs 10.0

# [11.2.1] - 2022-02-01
### added missing node red tags
 
# [11.2.0] - 2022-01-04
### fixed socks5 support - [#229](https://github.com/windkh/node-red-contrib-telegrambot/issues/229) 
replaced socks5-https-client with socks-proxy-agent 

# [11.1.0] - 2022-01-02
### fixed status of nodes - [#230](https://github.com/windkh/node-red-contrib-telegrambot/issues/230) 

# [11.0.1] - 2021-12-29
### minor internal refactorings

# [11.0.0] - 2021-12-19
### updated dependancies and node-telegram-bot-api to 0.56.0

# [10.4.1] - 2021-12-19
### Added full example for sendInvoice payments. 
- see also - [#225](https://github.com/windkh/node-red-contrib-telegrambot/pull/225) 

# [10.4.0] - 2021-12-19
### Fixed payment functions 
- see also - [#224](https://github.com/windkh/node-red-contrib-telegrambot/pull/224) 

# [10.3.0] - 2021-12-18
### added ne events My Chat Member and Chat Join Request

# [10.2.1] - 2021-12-18
### Extended example supergroupadmin.json

# [10.2.0] - 2021-12-12
### Added example flow for super group administration.
- added missing function banChatMember

# [10.1.0] - 2021-12-05
### Added webhook readme.
- Fixed timeout on redeploy when node is not in polling nor in webhook mode - [#220](https://github.com/windkh/node-red-contrib-telegrambot/issues/220)

# [10.0.9] - 2021-10-03
### Added webhook readme.
- see also - [#207](https://github.com/windkh/node-red-contrib-telegrambot/issues/209)

# [10.0.8] - 2021-10-03
### Added new example fro sending photos as buffer.

# [10.0.7] - 2021-08-28
### Tried to fix race crash
- try to fix - [#207](https://github.com/windkh/node-red-contrib-telegrambot/issues/207)

# [10.0.6] - 2021-08-22
### Minor improvements.
- improved - [#198](https://github.com/windkh/node-red-contrib-telegrambot/issues/198)

# [10.0.5] - 2021-08-02
### Internal fixed when internally registering command nodes at the config node.
- improved - [#197](https://github.com/windkh/node-red-contrib-telegrambot/issues/197)

# [10.0.4] - 2021-08-01
### Added bot command scopes (see setMyCommands).
- new - [#193](https://github.com/windkh/node-red-contrib-telegrambot/issues/193)

# [10.0.3] - 2021-07-31
### Bot is restarted on polling error.
- next try to fix - [#172](https://github.com/windkh/node-red-contrib-telegrambot/issues/172)

# [10.0.2] - 2021-07-25
### bot can run in send only mode which is neither polling nor webhook.
- merged - [#151](https://github.com/windkh/node-red-contrib-telegrambot/issues/151)

# [10.0.1] - 2021-07-25
### answerInlineQuery supports options now
- merged - [#194](https://github.com/windkh/node-red-contrib-telegrambot/pull/194)

# [10.0.0] - 2021-07-24
### upgrade to node-telegram-bot-api 0.54.0
- update - [#190](https://github.com/windkh/node-red-contrib-telegrambot/issues/190)

# [9.6.2] - 2021-07-24
### fixed callback_query bug
- fix - [#191](https://github.com/windkh/node-red-contrib-telegrambot/issues/191)

# [9.6.1] - 2021-07-24
### fixed setMyCommands
- fix - [#192](https://github.com/windkh/node-red-contrib-telegrambot/issues/192)

# [9.6.0] - 2021-07-21
### you can choose a language for your command registration now.
- new - [#189](https://github.com/windkh/node-red-contrib-telegrambot/issues/189)

# [9.5.0] - 2021-07-04
### commands can be registered automatically at the server (see /secommands or /setMyCommands).
- new - [#187](https://github.com/windkh/node-red-contrib-telegrambot/issues/187)

# [9.4.3] - 2021-05-24
### added optional argument for creating polls.
- fixed - [#181](https://github.com/windkh/node-red-contrib-telegrambot/issues/181)

# [9.4.2] - 2021-05-13
### added workaround for editMessageMedia support as sending local files does not work
- workaround for - [#178](https://github.com/windkh/node-red-contrib-telegrambot/issues/178)
- created issue - https://github.com/yagop/node-telegram-bot-api/issues/876

# [9.4.1] - 2021-05-06
### added editMessageMedia support

# [9.4.0] - 2021-05-02
### fix of last changes: chat is is taken from message in events if available.
- fixed - [#175](https://github.com/windkh/node-red-contrib-telegrambot/issues/175)

# [9.3.1] - 2021-05-02
### rebuild

# [9.3.0] - 2021-05-02
### fixed chat id exceptions in event nodes.
- fixed - [#175](https://github.com/windkh/node-red-contrib-telegrambot/issues/175)

# [9.2.1] - 2021-04-07
### exception in event node.
- fixed - [#168](https://github.com/windkh/node-red-contrib-telegrambot/issues/168)

# [9.1.2] - 2021-04-07
### refactored status events

# [9.0.0] - 2021-04-03
### upgrade underlying library to version 0.52.0 
- fixed - [#166](https://github.com/windkh/node-red-contrib-telegrambot/issues/166)

# [8.12.0] - 2021-04-02
### added ESLint, Prettier for maintinaing consistency in code style
- fixed - [#158](https://github.com/windkh/node-red-contrib-telegrambot/issues/158)

# [8.11.1] - 2021-04-01
### Readme updated for MarkdownV2
 
# [8.11.0] - 2021-04-01
### callback_query authorization adapted so that only group chat id needs to be configured.
- fixed - [#165](https://github.com/windkh/node-red-contrib-telegrambot/issues/165)
 
# [8.10.0] - 2021-03-08
### Added argument fileOptions in sendDocument, sendVoice, sendAudio, sendSticker, sendAnimation, sendVideo, ...
- fixed - [#161](https://github.com/windkh/node-red-contrib-telegrambot/issues/161)
 
# [8.9.7] - 2021-02-07
### Fixed bug in error handling of sender node.
 
# [8.9.6] - 2020-12-03
### Extended webhook mode (options and help)
 - merged  - [#147](https://github.com/windkh/node-red-contrib-telegrambot/issues/147)
 
# [8.9.5] - 2020-12-01
### Extended webhook mode (options and help)
 - fixed  - [#146](https://github.com/windkh/node-red-contrib-telegrambot/issues/146)
 
# [8.9.4] - 2020-12-01
### Added bluebird dependency
 - fixed  - [#145](https://github.com/windkh/node-red-contrib-telegrambot/issues/145)
 
# [8.9.3] - 2020-11-30
### Added flag in command node to remove the first match when using regular expressions.
 - extended  - [#122](https://github.com/windkh/node-red-contrib-telegrambot/issues/122)
 
# [8.9.2] - 2020-11-30
### Updated Readme.md
 
# [8.9.1] - 2020-11-29
### Added second output to sender node for handling errors.
 - fixed  - [#142](https://github.com/windkh/node-red-contrib-telegrambot/issues/142)
 
# [8.9.0] - 2020-11-29
### Refactored error handling for sender and event node.
 - fixed  - [#142](https://github.com/windkh/node-red-contrib-telegrambot/issues/142)
 
# [8.8.2] - 2020-11-29
### Fixed bug for action or sendChatAction
 - fixed  - [#144](https://github.com/windkh/node-red-contrib-telegrambot/issues/144)
 
# [8.8.1] - 2020-11-22
### Minor changes in readme and help
 
# [8.8.0] - 2020-11-08
### Adapted to new bot api V5: unpinAllChatMessages, pinChatMessage,...
 - fixed  - [#141](https://github.com/windkh/node-red-contrib-telegrambot/issues/141)
 - fixed  - [#140](https://github.com/windkh/node-red-contrib-telegrambot/issues/140)
 - fixed  - [#138](https://github.com/windkh/node-red-contrib-telegrambot/issues/138)
 
# [8.7.2] - 2020-11-04
### Fixed bug in callback_query message id. 
 - see Payload.messageId information when using -Event node- with -Callback Query- parameter  - [#136](https://github.com/windkh/node-red-contrib-telegrambot/issues/136)
 
 # [8.7.1] - 2020-10-03
### Fixed bug in callback_query auto answer. 
 - see Callback Query Trigger does not work - [#134](https://github.com/windkh/node-red-contrib-telegrambot/issues/134)
 
## [8.7.0] - 2020-10-03
### Added regular expression support to command node. 
 - see Allow command regex - [#122](https://github.com/windkh/node-red-contrib-telegrambot/issues/122)
 - added copyright limitation for commercial products
 
## [8.6.5] - 2020-09-30
### Keyboard types (custom keyboard and inline keyboard) description added.

## [8.6.4] - 2020-09-10
### Added example flow for creating a poll.

## [8.6.3] - 2020-09-10
### Added pre_checkout_query for sendInvoice feature.
 - added events to event node: pre_checkout_query, shipping_query, chosen_inline_result, poll, poll_answer
 - added poll support (preview)
 - see SendInvoice - [#119](https://github.com/windkh/node-red-contrib-telegrambot/issues/119)

## [8.6.2] - 2020-09-07
### README.md display problem
 - Display problem fixed when using the <details> tags: Added additional blank line behind.

## [8.6.1] - 2020-09-06
### When bot is stopped it won't restore to "polling" state

## [8.6.0] - 2020-09-06
### Token can be read from env variable
 - Change Token ID. - [#124](https://github.com/windkh/node-red-contrib-telegrambot/issues/124)

## [8.5.0] - 2020-09-03
### Docu rework
### Typo in .html
- Ouput -> Output

### Minor bugfix in .js
- date field added at text message

## [8.4.0] - 2020-08-14
### Updated to node-telegram-bot-api 0.50.0

## [8.3.3] - 2020-07-26
### Polling Error status is reset after 80% poll interval
 - Reset error status after a period when polling. - [#97](https://github.com/windkh/node-red-contrib-telegrambot/issues/97)

## [8.3.2] - 2020-07-26
### Alpha feature sendInvoice
 - Added sendInvoice, answerShippingQuery, answerPreCheckoutQuery for testing - [#119](https://github.com/windkh/node-red-contrib-telegrambot/issues/119)

## [8.3.1] - 2020-07-26
### Fixed
 - Fixed has response behavior - [#115](https://github.com/windkh/node-red-contrib-telegrambot/issues/115)

## [8.3.0] - 2020-07-26
### Fixed
 - Fixed typo in event node (callback_query) - [#114](https://github.com/windkh/node-red-contrib-telegrambot/issues/114)

## [8.2.0] - 2020-06-14
### Fixed
 - Fixed wrong chat id when sending to many chats - [#111](https://github.com/windkh/node-red-contrib-telegrambot/issues/111)

## [8.1.0] - 2020-05-02
### Added
 - Reordered html properties
 - New option in `Telegram reciever node` to automatically filter configured `command nodes` - [#108](https://github.com/windkh/node-red-contrib-telegrambot/pull/108)
 - New `CHANGELOG` file to remove the info from the `README` - [#107](https://github.com/windkh/node-red-contrib-telegrambot/pull/107)

### Changed
 - New updated icons to - [#106](https://github.com/windkh/node-red-contrib-telegrambot/issues/106)

## [8.0.0] - 2020-04-13
### Added
 - Command nodes will only send the response to the second output if a command is pending - [#103](https://github.com/windkh/node-red-contrib-telegrambot/issues/103)

## [7.2.1] - 2020-04-13
### Added
 - Second output of command node can be disabled now - [#103](https://github.com/windkh/node-red-contrib-telegrambot/issues/103)

## [7.2.0] - 2020-03-29
### Added
 - Dynamic authorization - [#99](https://github.com/windkh/node-red-contrib-telegrambot/issues/99)

## [7.1.5] - 2020-03-22
### Added
 - Option to send the same message to many different chats

## [7.1.4] - 2020-03-21
### Fixed
 - Bot polling is not stopped when socks5 error (e.g. when network is down) - [#97](https://github.com/windkh/node-red-contrib-telegrambot/issues/97)

## [7.1.3] - 2020-03-21
### Added
 - Sending and receiving animations - [#95](https://github.com/windkh/node-red-contrib-telegrambot/issues/95)

## [7.1.2] - 2020-03-21
### Added
 - Function `forwardMessage` - [#101](https://github.com/windkh/node-red-contrib-telegrambot/issues/101)

## [7.0.0] - 2019-11-24
### Changed
 - Updated dependancy npm module [node-telegram-bot-api](https://www.npmjs.com/package/node-telegram-bot-api) to latest release `v0.40.0`

## [6.0.1] - 2019-11-24
### Removed
 - Warning when nodes register twice at the configuration node - [#87](https://github.com/windkh/node-red-contrib-telegrambot/issues/87)

## [6.0.0] - 2019-10-28
### Changes
 - Modified nodes to support `Node-RED 1.0+` (async) - [#85](https://github.com/windkh/node-red-contrib-telegrambot/issues/85)

## [5.5.0] - 2019-04-15
### Fixed
 - Functions: `restrictChatMember`, `kickChatMember`, `promoteChatMember`, `unbanChatMember` - [#71](https://github.com/windkh/node-red-contrib-telegrambot/issues/71)

## [5.4.0] - 2019-04-02
### Added
 -  Function `sendMediaGroup` - [#68](https://github.com/windkh/node-red-contrib-telegrambot/issues/68)

## [5.3.0] - 2019-02-16
### Added
 - Support for custom and non custom certificates in webhook mode - [#66](https://github.com/windkh/node-red-contrib-telegrambot/issues/66)

### Changed
 - Improved configuration node: grouped properties.

## [5.2.1] - 2019-02-02
### Added
 - SOCKS5 support - [#43](https://github.com/windkh/node-red-contrib-telegrambot/issues/43)

## [5.0.0] - 2018-12-29
### Added
 - Webhooks supported

### Changes
 - Configuration node was changed so that the required properties for webhook can be configured

## [4.8.0] - 2018-12-27
### Changes
 - Results returned by the sender node were changed for direct commands like for example  editMessageLiveLocation, stopMessageLiveLocation, editMessageCaption, ... in a way that the `msg.payload.content` now contains the full object returned by the request instead of the `msg.payload.sentMessageId` property. All flows that did not make any use of those special functions should not be affected.

## [4.x.x]
### Changes
 - Replaced the former callback query node with the generic event node (breaking change). You can replace the former callback query node in your existing flows with the event node. Please configure this event node to receive the callback query event.

**Note:** The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
