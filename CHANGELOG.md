# Changelog
All notable changes to this project will be documented in this file.

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
