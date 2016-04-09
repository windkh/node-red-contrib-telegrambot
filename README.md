# Telegram bot nodes for node-red

This package contains a receiver and a sender node which act as a telegram bot.
The only thing required is the token that can be retrieved by the @botfather telegram bot.
https://core.telegram.org/bots


# Dependencies
The nodes are a simple wrapper around the  [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)


# Warning
The nodes are tested with v4.2.1  (ECMAScript 6).
The project is still under construction.


# Usage
The input node receives messages from the bot and sends a message object with the following layout:
- **payload** contains the message details
  - **chatId**  : the unique id of the chat. This value needs to be passed to the out node when responding to the same chat.
  - **type**    : the type of message received: message, photo, audio, location, video, voice, contact
  - **content** : received message content: string or file_id, or object with full data (location, contact)

- **originalMessage** contains the original message object from the underlying [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) lib.


The simple echo flow looks like:
![Alt text](images/TelegramBotEcho.png?raw=true "Echo Flow")


## Configuration Node
The only thing to be entered here is the token which you received from @botfather when creating a new bot.
The string is automatically trimmed.
The node contains two optional properties: users and chatids. You may enter a list of names and/or chatids that
are authorized to use this bot. This is useful, if the bot should only accept incoming calls from dedicated persons.
The values in the property fields must be separated by a , e.g.:
Hugo,Sepp,Egon 
Leave the fields blank if you do not want to use this feature.


## Receiver Node
This node receives all messages from a chat. Simply invite the bot to a chat. 
(You can control if the bot receives every message by calling /setprivacy @botfather.)
The original message from the underlying node library is stored in msg.originalMessage.
msg.payload contains the most important data like chatId, type and content. The content depends
on the message type. E.g. if you receive a message then the content is a string. If you receive a location,
then the content is an object containing latitude and logitude. 
The second output is triggered when security is applied. See below.


## Sender Node
This node sends the payload to the chat. The payload must contain the floowing fields:
msg.payload.chatId  - chatId
msg.payload.type    - e.g. "message"
msg.payload.content - your message text


## Command Node
The command node can be used for triggering a message when a specified command is received: e.g. help.
See example below.
It has two outputs
- 1. is triggered when the command is received
- 2. is triggered when the command is not received

The second one is useful when you want to use a keyboard. 
See example below.


## Implementing a simple echo 
This example is self-explaining. The received message is returned to the sender.
![Alt text](images/TelegramBotEcho.png?raw=true "Echo Flow")


## Implementing a /help command
This flow returns the help message of your bot. It receives the command and creates a new message, which is returned:
![Alt text](images/TelegramBotHelp.png?raw=true "Help Command Flow")

![Alt text](images/TelegramBotHelp2.png?raw=true "Help Function")

Note: You can access the sender's data via the originalMessage property.


## Implementing a keyboard
Keyboards are very useful for getting additional data from the sender.
When the command is received the first output is triggered and a dialog is opened:
![Alt text](images/TelegramBotConfirmationMessage.png?raw=true "Keyboard Flow")

![Alt text](images/TelegramBotConfirmationMessage2.png?raw=true "Keyboard Function 1")

The answer is send to the second output triggering the lower flow. Data is passed via global properties here.

![Alt text](images/TelegramBotConfirmationMessage3.png?raw=true "Keyboard Function 2")


## Implementing a on reply node
Next to the keyboard the bot could also ask a question and wait for the answer.
When the user responds to a specified message the telegram reply node can be used:
![Alt text](images/TelegramBotOnReplyMessage.png?raw=true "OnReply Flow")

![Alt text](images/TelegramBotOnReplyMessage2.png?raw=true "Create question")

The question is sent to the chat. This node triggers the on reply node waiting for the answer.
Note that the user has to explicitly respond to this message. If the user only writes some text,
the node will not be triggered.

![Alt text](images/TelegramBotOnReplyMessage3.png?raw=true "Switch function")
The last function shows how to evaluate the answer using a function node with two outputs.

 
## Receiving a location
Locations can be send to the chat. The bot can receive the longitude and latitude:
![Alt text](images/TelegramBotLocation.png?raw=true "Location Function")


## Sending messages to a specified chat 
If you have the chatId, you can send any message without the need of having received something before.
![Alt text](images/TelegramBotSendToChat.png?raw=true "Sending a message")


## Sending photos, videos, ...
Next to sending text messages you can send almost any content like photos and videos. Set the right type and content and you are done.
If you want to respond to a received message with a picture you could write:
msg.payload.content = 'foo.jpg';
msg.payload.type = 'photo';
Note that the chatId is already the correct one when you reuse the received msg object.

You can use one of the follwing types to send your file as content:
- photo
- audio
- video
- sticker
- voice
- document

The following types require a special content format to be used. See the underlying node api for further details.
- location
- contact 

![Alt text](images/TelegramBotSendPhoto.png?raw=true "Sending a photo")
![Alt text](images/TelegramBotSendPhoto2.png?raw=true "Setting the correct content type.")


## Advanced options when sending messages.
Text messages can be in markdown format to support fat and italic style. To enable markdown format 
set the parse_mode options property as follows:
msg.payload.options = {parse_mode : "Markdown"};

Telegram always adds a preview when you send a web link. To suppress this behavior you can disable the preview 
by settings the options property as follows:
msg.payload.options = {disable_web_page_preview : true};


## Configuring security 
The configuation node contains two properties for applying security to your bot. You can choose between configuring
the single usernames or configure one or more chat-ids that are allowed to access the bot. The values must be separated using 
a comma like shown in the screenshot.
![Alt text](images/TelegramBotSecurity.png?raw=true "Applying security")
Note that the chat-ids are positive in chats where you talk to the bot in an 1:1 manner. A negative chat-id indicates a group-chat.
Everybody in this group is allowed to use the bot if you enter the chat-id of the group into the lower field of the configuration node.


## Detecting unauthorized access.
The receiver node has a second output, that is triggered when authorization fails. The message is send to this output for further processing.
You can reply on that message or log it to a file to see who wanted to access your bot.
![Alt text](images/TelegramBotUnauthorizedAccess.png?raw=true "Logging unauthorized access")

The message needs to be formatted before the log to file node can be triggered. A simple function could look like this:
![Alt text](images/TelegramBotUnauthorizedAccess2.png?raw=true "Create logging string with full information.")


## Implementing a simple bot 
Putting all pieces together you will have a simple bot implementing some useful functions.
![Alt text](images/TelegramBotExample.png?raw=true "Bot example")

All example flows can be found in the examples folder of this package. 


# License

Author: Karl-Heinz Wind

The MIT License (MIT)
Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.