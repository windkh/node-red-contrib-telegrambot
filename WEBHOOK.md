# Webhook examples
As setting up a webhook can be very error prone the following chapter may help you in this quest.



## Example 1: Webhook with certificate 
As a prerequisite you have to create your own certificate as described there:
- https://core.telegram.org/bots/webhooks
- https://stackoverflow.com/questions/42713926/what-is-easy-way-to-create-and-use-a-self-signed-certification-for-a-telegram-we  

One of many pitfalls when creating certificates (that don't work) is, that the value CN you provided to openssl must match the bots domain name: see *Bot Host* below.
Create our pair of private and public keys using the following command:
```
openssl req -newkey rsa:2048 -sha256 -nodes -keyout PRIVATE.key -x509 -days 365 -out PUBLIC.pem -subj "/C=DE/ST=Bavaria/L=Munich/O=YOUR_NAME_OR_COMPANY_NAME/CN=SERVER_NAME_OR_IP"
```
Important:
Replace *SERVER_NAME_OR_IP* with the name you entered in the configuration node under ***Bot Host*** in the *Webhook Options*. Both names must be equal, otherwise the telegram server won't send updates to your bot.
You should also replace *YOUR_NAME_OR_COMPANY_NAME* with some value.

Note that the certificate will expire after 365 days and needs to be renewed (e.g. see [there](https://securitywing.com/how-renew-self-signed-ssl-certificate-openssl-tool-linux/)).

[**example bat file for creating a certificate can be found here**](examples/makecert.bat)  

<img src="images/TelegramBotWebHookConfiguration.png" title="Webhook configuration with self signed sertificate" width="350" />

**Fig. 1:** Example configuration for webhook mode

Instead of using self signed certificates you can use officially signed ones. This can be very expensive, but note that for example Windows 10
automatically deletes self signed certificates from time to time (during the windows update) to protect the system from any software that tries to build up tunnels using self signed and thus easy to create certificates.


##  Example 2: Without certificates in Unraid/Docker with SWAG/NGINX/REVERSE-PROXY
Webhook can also be used without certificate but then the bot host must be behind a tunnel see https://github.com/windkh/node-red-contrib-telegrambot/pull/93. Thanks to daredoes for proving the following description.



### Node Red

Set the Bot Settings to the following:

![image](https://user-images.githubusercontent.com/6538753/131450588-b2995151-b98c-4427-b3f0-9a7e92604ab0.png)

**Fig. 2:** Example configuration for webhook mode without SSL

`Update Mode - Webhook` - Setting this value to `Webhook` will be necessary for receiving our updates via webhook.

`Bot Host - telebot.yourdomain.com` - Obviously, hopefully, `yourdomain.com` is a filler that you should replace with *your domain*. We're going to use `telebot` in this example though.

`Bot Path - blank` - We're going to leave this blank, best not to break anything.

`Public Bot Port - 443` - We're setting this to 443, the SSL public port for a website, because we're assuming we have setup a reverse-proxy with certs through something like DuckDNS and SWAG

`Local Bot Port - 8443` - This is the default value, but take note of it as we'll be using it soon. Don't set this to 1880 or whatever port Node-Red is running on, or you're gonna have a bad time. Like everything crashes, restart node red in safe mode and change the port bad time.

` Certificate is Self-Signed - Unchecked` - I'm pretty sure it's not self-signed through DuckDNS, so...

`SSL Terminated By Reverse Proxy - Checked` - By enabling this, we skip the need to do all that complex stuff involving certificate signing and whatever. Woo!



### Node Red + Docker/Unraid

If you're like me, you're running this on something like HomeAssistant or Unraid. I'm running it on Unraid. Well, to make sure Telegram can send webhooks to our bot, we need to make sure our bot, running at port `8443` can be reached from our reverse-proxy.

Let's edit our node-red docker instance, and `Add another Path, Port, Variable, Label, or Device`, then fill in the modal with the following values:

![image](https://user-images.githubusercontent.com/6538753/131451461-74647265-5056-4843-a6ac-320ef9f8d9c7.png)

**Fig. 3:** Example docker configuration

Apply the changes, and you should see the following on your docker status page.

![image](https://user-images.githubusercontent.com/6538753/131451391-248cdda3-5c1f-4843-8587-ec4f65287ca5.png)

**Fig. 4:** Example docker status page



### SWAG Proxy Conf

If you're also like me, you're running SWAG to do a reverse-proxy. Create a new subdomain proxy for `telebot`, our previously noted subdomain.

My configuration looks like this.

![image](https://user-images.githubusercontent.com/6538753/131451336-cdbd22bf-422a-4a8d-ab7c-d1efd9762472.png)

**Fig. 5:** Example SWAG configuration

```text
server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name telebot.*;

    include /config/nginx/ssl.conf;

    client_max_body_size 0;

    # enable for ldap auth, fill in ldap details in ldap.conf
    #include /config/nginx/ldap.conf;

    # enable for Authelia
    #include /config/nginx/authelia-server.conf;

    location / {
        # enable the next two lines for http auth
        #auth_basic "Restricted";
        #auth_basic_user_file /config/nginx/.htpasswd;

        # enable the next two lines for ldap auth
        #auth_request /auth;
        #error_page 401 =200 /ldaplogin;

        # enable for Authelia
        #include /config/nginx/authelia-location.conf;

        include /config/nginx/proxy.conf;
        resolver 127.0.0.11 valid=30s;
        set $upstream_app 192.168.1.55;
        set $upstream_port 8443;
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;

    }
}
```



### Last But Not Least

Add your domain to your SWAG instance subdomains so it gets certified. Add the subdomain to your DNS records as a CNAME, or however you handle that stuff.

Once all of this is done, messages should come back from nodes pretty rapidly!

Hope this helps.
