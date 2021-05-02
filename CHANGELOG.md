# Changelog
All notable changes to this project will be documented in this file.

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
