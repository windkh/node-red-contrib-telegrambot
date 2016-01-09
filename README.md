# Telegram bot nodes for node-red

This package contains a receiver and a sender node which act as a telegram bot.
The only thing required is the token that can be retrieved by the @botfather telegram bot.
[https://core.telegram.org/bots]

The nodes are a simple wrapper around the  [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

# Usage
The input node receives messages from the bot and sends a message object with the following layout:
- **payload** contains the message details
  - **chatId** : the unique id of the chat. This value needs to be passed to the out node when responding to the same chat.
  - **text**   : received message

- **originalMessage** contains the original message object from the underlying [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) lib.


The simplest echo flow looks like:
![Alt text](TelegramBotFlow.png?raw=true "Sample Flow")

# Warning
Only text messages are supported at the moment.
The project is under heavy construction right now.

Author: Karl-Heinz Wind
