REM We assume that git for windows is installed: openssl.exe can be found there.
REM Follow these steps to install a webhook
REM make sure that your server is reachable from the internet: e.g. yourname.spdns.de 
REM make sure that your router allows traffic via TCP port 8443 to your server
REM create a certificate with the correct internet address see above: yourname.spdns.de
REM configure the bot in node-red: webhook, public port 8443, private port 8443, path to PRIVATE.key and path to PUBLIC.pem
REM make sure that the checkbox "Certificate is self signed is checked"

set OPENSSL="%ProgramFiles%\Git\usr\bin\openssl.exe"

del PRIVATE.key
del PUBLIC.pem
%OPENSSL% req -newkey rsa:2048 -sha256 -nodes -keyout PRIVATE.key -x509 -days 365 -out PUBLIC.pem -subj "/C=DE/ST=Bavaria/L=Munich/O=HeinzBot/CN=ihive.spdns.de"

pause