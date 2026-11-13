# Runs ON THE DROPLET, as the remote command of deploy-live.yml's
# "Install the Sender secret for nginx" step, with the include rendered by
# render-sender-secret.sh on stdin:
#
#   render-sender-secret.sh | ssh root@droplet "$(cat deploy/nginx/install-sender-secret.sh)"
#
# The script text is the command line; the secret only ever travels on stdin.
#
# nginx fails to parse a truncated include, so sender.conf is never written in
# place. The new copy goes to a temp name the snippet's `sender.con[f]` glob
# cannot match, and is renamed over sender.conf only once its last line is the
# complete group line render-sender-secret.sh always ends with. A dropped
# connection can end stdin early without killing this shell, so the rename alone
# is not enough. A copy that fails the check is removed and the old one stays.
#
# SENDER_SECRET_DIR exists for the tests (deploy/nginx/test/); ssh passes no
# environment, so on the droplet it is always the default.
set -eu
d="${SENDER_SECRET_DIR:-/etc/nginx/cinemaslime-secrets}"
new="$d/.sender.conf.new"
install -d -m 0700 "$d"
# Not `install /dev/stdin`: GNU install cannot copy it over an existing file,
# and opening /dev/stdin fails outright when stdin is a socket. A temp copy an
# interrupted run left behind is removed so the new one is created 0600.
rm -f "$new"
(umask 077 && cat > "$new")
if ! tail -n 1 "$new" | grep -qx 'set .sender_group "[A-Za-z0-9]\{1,64\}";'; then
    rm -f "$new"
    echo "install-sender-secret: the include arrived incomplete; $d/sender.conf is unchanged" >&2
    exit 1
fi
mv -f "$new" "$d/sender.conf"
