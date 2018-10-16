# Telegram bot nodes for node-red

This package contains a receiver and a sender node which act as a telegram bot.
The only thing required is the token that can be retrieved by the @botfather telegram bot.
https://core.telegram.org/bots

# Credits
dvv (Vladimir Dronnikov) for providing the saveDataDir configuration option.
snippet-java for adding venue messages. And for providing the markdown problem fallback.

greenstone7 for providing the callback query node.

dceejay for cleaning up the project

psyntium for providing the weblink for additional content link videos, pictures, audio files.
 
MatthiasHunziker for extending the callback query node to support generic events

Skiepp for providing the send chat action idea.

# Dependencies
The nodes are a simple wrapper around the  [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

# History
Version 4.x.x
Breaking changes: the former callback query node was replaced by the generic event node. 
You can replace the former callback query node in your existing flows with the event node. Please configure this event node
to receive the callback query event.

# Warning
The nodes are tested with nodejs 8.11.1 and node-red 0.18.4.


# Usage
The input node receives messages from the bot and sends a message object with the following layout:

 `msg.payload` contains the message details
  - **chatId**  : the unique id of the chat. This value needs to be passed to the out node when responding to the same chat.
  - **type**    : the type of message received: message, photo, audio, location, video, voice, contact
  - **content** : received message content: string or file_id, or object with full data (location, contact)

`msg.originalMessage` contains the original message object from the underlying [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) lib.

The output node sends the content to a sepcified chat.
A simple echo flow looks like:

![Alt text](images/TelegramBotEcho.png?raw=true "Echo Flow")
[echo flow](examples/echo.json)


## Configuration Node
The only thing to be entered here is the token which you received from @botfather when creating a new bot.
The string is automatically trimmed.
The node contains two optional properties: users and chatids. You may enter a list of names and/or chatids that
are authorized to use this bot. This is useful, if the bot should only accept incoming calls from dedicated persons.
The values in the property fields must be separated by a , e.g.:
Hugo,Sepp,Egon
Leave the fields blank if you do not want to use this feature.
saveDataDir is an optional configuration value that can be set to automatically download all contents like music, video, documents, etc.


## Receiver Node
This node receives all messages from a chat. Simply invite the bot to a chat.
(You can control if the bot receives every message by calling /setprivacy @botfather.)
The original message from the underlying node library is stored in msg.originalMessage.
msg.payload contains the most important data like chatId, type and content. The content depends
on the message type. E.g. if you receive a message then the content is a string. If you receive a location,
then the content is an object containing latitude and longitude.
The second output is triggered when security is applied and the user is not authorized to access the bot. See below.

When the receiver node receives data like videos, documents and so on, the file is downloaded automatically to the local harddisc when
saveDataDir is set in the configuration node. The directory is also part of the message payload: msg.payload.path
In addition to that the message contains the direct download link in the payload: msg.payload.weblink


## Sender Node
This node sends the payload to the chat. The payload must contain the following fields:
msg.payload.chatId  - chatId
msg.payload.type    - e.g. "message"
msg.payload.content - your message text
msg.error           - is set when an exception occurred


## Command Node
The command node can be used for triggering a message when a specified command is received: e.g. help.
See example below.
It has two outputs

 1. is triggered when the command is received
 2. is triggered when the command is not received

The second one is useful when you want to use a keyboard. See example below.
Commands usually start with a / like for example /foo. According to the telegram api documentation the command
should be issued following the bot name like /foo@YourBot. This is important when you add several different bots
to one single group chat. To avoid that the bot handles commands that are not directly sent to it using the long notation
you can set the "strict" mode in the options of the command node. In this case the bot only accepts the full command
notation in group chats.  


## Event Node
The node receives events from the bot like:
- callback_query of inline keyboards.
See example-flow [inline keyboard flow](examples/inlinekeyboard.json) in examples folder.
- inline_query
- edited_message which is triggered when someone alters an already sent message.
- channel_post which is triggered when the bot is member of a public channel (/setprivacy to disabled!).
- edited_channel_post which is triggeren when someone alters an already sent message in a public channel.


## Reply Node
The reply node waits for an answer to a specified message. It should be used in conjunction with the sender node:
See example below.


## Implementing a simple echo
This example is self-explaining. The received message is returned to the sender.
![Alt text](images/TelegramBotEcho.png?raw=true "Echo Flow")

[echo flow](examples/echo.json)


## Implementing a /help command
This flow returns the help message of your bot. It receives the command and creates a new message, which is returned:
![Alt text](images/TelegramBotHelp.png?raw=true "Help Command Flow")

![Alt text](images/TelegramBotHelp2.png?raw=true "Help Function")

**Note**: You can access the sender's data via the originalMessage property.


## Implementing a keyboard
Keyboards are very useful for getting additional data from the sender.
When the command is received the first output is triggered and a dialog is opened:
![Alt text](images/TelegramBotConfirmationMessage.png?raw=true "Keyboard Flow")
[keyboard flow](examples/keyboard.json)

![Alt text](images/TelegramBotConfirmationMessage2.png?raw=true "Keyboard Function 1")

The answer is send to the second output triggering the lower flow. Data is passed via global properties here.

![Alt text](images/TelegramBotConfirmationMessage3.png?raw=true "Keyboard Function 2")


## Implementing a on reply node
Next to the keyboard the bot could also ask a question and wait for the answer.
When the user responds to a specified message the telegram reply node can be used:
![Alt text](images/TelegramBotOnReplyMessage.png?raw=true "OnReply Flow")
[onreplymessage flow](examples/onreplymessage.json)

![Alt text](images/TelegramBotOnReplyMessage2.png?raw=true "Create question")

The question is sent to the chat. This node triggers the on reply node waiting for the answer.

**Note**: that the user has to explicitly respond to this message. If the user only writes some text,
the node will not be triggered.

![Alt text](images/TelegramBotOnReplyMessage3.png?raw=true "Switch function")
The last function shows how to evaluate the answer using a function node with two outputs.


## Implementing an inline keyboard
An inline keyboard contains buttons that can send a callback query back to the bot to trigger any kind of function.
When the command is received the first output is triggered and a inline keyboard is shown:
![Alt text](images/TelegramBotInlineKeyboard1.png?raw=true "Inline Keyboard Flow")
[inlinekeyboard flow](examples/inlinekeyboard.json)

![Alt text](images/TelegramBotInlineKeyboard2.png?raw=true "Inline Keyboard Function 1")

The callback query is received by the event node. It must be answered like shown as follows:
Here you can add your code to trigger the desired bot command. The answer contains the callback query data in msg.payload.content.

![Alt text](images/TelegramBotInlineKeyboard3.png?raw=true "Inline Keyboard Function 2")


## Edit an inline keyboard
An inline keyboard can be modified using the 'editMessageReplyMarkup' instruction. To be able to modify an existing message you need
to know the messageId of the message of the keyboard.
A sample flow is provided in the examples folder and could look like this:
![Alt text](images/TelegramBotEditInlineKeyboard1.png?raw=true "Edit Inline Keyboard Flow")
[editinlinekeyboard flow](examples/editinlinekeyboard.json)

![Alt text](images/TelegramBotEditInlineKeyboard2.png?raw=true "Showing the initial keyboard")

The message id needs to be saved in the flow or global context. This is just a demo assuming that there is only one single chat.
![Alt text](images/TelegramBotEditInlineKeyboard3.png?raw=true "Storing the messageId of the keyboard")

Replace the initial keyboard with a modified one using the magic 'editMessageReplyMarkup' command as type.
![Alt text](images/TelegramBotEditInlineKeyboard4.png?raw=true "Replacing the initial keyboard")

The following switch node just handles the response and hides the keyboard using another magic command: 'deleteMessage'
![Alt text](images/TelegramBotEditInlineKeyboard5.png?raw=true "Handling the keyboard response")

As an alternative to 'editMessageReplyMarkup' you can also use 'editMessageText' to replace the keyboard and also the text as follows:
![Alt text](images/TelegramBotEditInlineKeyboard6.png?raw=true "Replacing the initial keyboard and the text")


## Implementing an inline_query 
Bots can be called from any chat via inline_query when the bot is set to inline mode in botfather via /setinline
see https://core.telegram.org/bots/api#inline-mode
A sample flow is provided in the examples folder and could look like this:
![Alt text](images/TelegramBotInlineQuery1.png?raw=true "Answer Inline Query Flow")
[inlinequery flow](examples/inlinequery.json)

The inline_query must be answered by sending a results array.
see https://core.telegram.org/bots/api#inlinequeryresult
The example just returns two simple articles, but almost every kind of content can be returned. 
![Alt text](images/TelegramBotInlineQuery2.png?raw=true "Creating the results array")

Note that the inline_query can also contain the location of the sender. To enable this call /setinlinegeo in botfather
 

## Receiving a location
Locations can be send to the chat. The bot can receive the longitude and latitude:
![Alt text](images/TelegramBotLocation.png?raw=true "Location Function")


## Sending messages to a specified chat
If you have the chatId, you can send any message without the need of having received something before.
![Alt text](images/TelegramBotSendToChat.png?raw=true "Sending a message")
[sendmessagetochat flow](examples/sendmessagetochat.json)


## Sending photos, videos, ...
Next to sending text messages you can send almost any content like photos and videos. Set the right type and content and you are done.
If you want to respond to a received message with a picture you could write:
```
msg.payload.content = 'foo.jpg';
msg.payload.type = 'photo';
```

**Note**: that the chatId is already the correct one when you reuse the received msg object from a receiver node.

You can use one of the following types to send your file as content:
- [photo](examples/sendphoto.json)
- audio
- video
- video_note
- sticker
- voice
- document
The content can be downloaded automatically to a local folder by setting the saveDataDir entry in the configuration node.
You can add a caption to photo, audio, document, video, voice by setting the caption property as follows:
```
msg.payload.caption = "You must have a look at this!";
```

The following types require a special content format to be used. See the underlying node api for further details.
- location
- contact
- venue
- callback_query
- action

![Alt text](images/TelegramBotSendPhoto.png?raw=true "Sending a photo")
![Alt text](images/TelegramBotSendPhoto2.png?raw=true "Setting the correct content type.")


## Sending contact
Sending a contact is limited to the fields supported by the underlying API to "phone_number" and "first_name".
But you can also receive "last_name" if the client sends it.

```
msg.payload.type = 'contact';
msg.payload.content : {  phone_number: "+49 110", first_name: "Polizei" };
```

![Alt text](images/TelegramBotSendContact.png?raw=true "Send Contact Flow")
[sendcontacttochat flow](examples/sendcontacttochat.json)

![Alt text](images/TelegramBotSendContact2.png?raw=true "Send Contact Function")


## Sending chat actions
When the bot needs some time for further processing but you want to give a hint to the user what is going on,
then you can send a chat action which will appear at the top of the channel of the receiver. 

```
msg.payload.type = 'action';
msg.payload.content = "typing";
```

The content can be one of the following 
- "typing" for text messages
- "upload_photo" for photos
- "record_video" or "upload_video" for videos
- "record_audio" or "upload_audio" for audio files
- "upload_document" for general files
- "find_location" for location data
- "record_video_note" or "upload_video_note" for video notes

The following example illustrate how to send for example "typing...".
Of course a real bot would send the real data after finishing the processing, but this is not part of the example.
[sendchataction flow](examples/sendchataction.json)


## Sending live location
Locations can be send to the chat as described above and then updated afterwards: live location update.
To achieve this you have to provide the live_period in seconds in the options when sending the location.

```
msg.payload.type = 'location';
msg.payload.content = {
    latitude : lat,
    longitude : lng
};

msg.payload.options = {
    live_period : time
};  
```

To be able to update this location message you need to store the message id of that sent message.
This can be done by storing it somewhere in the flow context as follows:

```
var messageId = msg.payload.sentMessageId;
flow.set("messageId", messageId);
```

Now you can edit the location as often as you want within the live_period:

```
var messageId = flow.get("messageId");
var chatId = msg.payload.chatId;

msg.payload.type = 'editMessageLiveLocation';
msg.payload.content = {
    latitude : lat,
    longitude : lng
};
  
msg.payload.options = {
    chat_id : chatId,
    message_id : messageId
};  
```

If you want to abort updating the location then you can send the stopMessageLiveLocation command.

```
var messageId = flow.get("messageId");
var chatId = msg.payload.chatId;

msg.payload.type = 'stopMessageLiveLocation';
msg.payload.options = {
    chat_id : chatId,
    message_id : messageId
};  
```

![Alt text](images/TelegramBotLiveLocation.png?raw=true "Live Location Flow")
[livelocation flow](examples/livelocation.json)

## Receiving live location updates
When a user sends his location then it is received by the standard message receiver node.
But when a live location is updated, then you will receive the same message event as one would
edit an already existing message in the chat (edit_message). The example above contains an event handler node that
receives those message edits, and filters for the ones that contain a location. 


## Advanced options when sending messages.
Text messages can be in markdown format to support fat and italic style. To enable markdown format
set the parse_mode options property as follows:
```
msg.payload.options = {parse_mode : "Markdown"};
```

Telegram always adds a preview when you send a web link. To suppress this behavior you can disable the preview
by setting the options property as follows:
```
msg.payload.options = {disable_web_page_preview : true};
```

The callback query answer has a show_alert option to control the visibility of the answer on the client.
It is directly mapped to the options property.
```
msg.payload.options = true;
```


## Configuring security
The configuration node contains two properties for applying security to your bot. You can choose between configuring
the single usernames or configure one or more chat-ids that are allowed to access the bot. The values must be separated using a comma like shown in the screenshot.

![Alt text](images/TelegramBotSecurity.png?raw=true "Applying security")

**Note**: that the chat-ids are positive in chats where you talk to the bot in an 1:1 manner. A negative chat-id indicates a group-chat.
Everybody in this group is allowed to use the bot if you enter the chat-id of the group into the lower field of the configuration node.


## Detecting unauthorized access.
The receiver node has a second output, that is triggered when authorization fails. The message is send to this output for further processing.
You can reply on that message or log it to a file to see who wanted to access your bot.
![Alt text](images/TelegramBotUnauthorizedAccess.png?raw=true "Logging unauthorized access")

The message needs to be formatted before the log to file node can be triggered. A simple function could look like this:
![Alt text](images/TelegramBotUnauthorizedAccess2.png?raw=true "Create logging string with full information.")
[unauthorizedaccess flow](examples/unauthorizedaccess.json)


## Implementing a simple bot
Putting all pieces together you will have a simple bot implementing some useful functions.
![Alt text](images/TelegramBotExample.png?raw=true "Bot example")
[simplebot flow](examples/simplebot.json)

All example flows can be found in the examples folder of this package.


# License

Author: Karl-Heinz Wind

The MIT License (MIT)
Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
