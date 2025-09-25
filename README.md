When you hit /print, it queues and logs tickets.
When each ticket prints, you get a success log.
If there’s an error (out of tickets, jam, etc.), it logs and retries.
You (or your frontend) can call /status anytime to fetch the last ~100 log entries.
