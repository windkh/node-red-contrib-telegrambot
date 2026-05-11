class QueueManager {
    constructor() {
        this.queues = new Map(); // chatId -> [funcs]
        this.processing = new Map(); // chatId -> boolean
    }

    enqueue(chatId, func) {
        if (!this.queues.has(chatId)) {
            this.queues.set(chatId, []);
            this.processing.set(chatId, false);
        }

        const queue = this.queues.get(chatId);
        queue.push(func);

        // wenn nichts läuft -> starten
        if (!this.processing.get(chatId)) {
            this.processCurrent(chatId);
        }
    }

    processCurrent(chatId) {
        const queue = this.queues.get(chatId);
        if (!queue || queue.length === 0) {
            this.processing.set(chatId, false);
            return;
        }

        this.processing.set(chatId, true);

        const func = queue[0];
        // A synchronous throw from the handler would otherwise leave the queue stuck:
        // `processing` stays true and the head is never shifted, so every subsequent
        // message for this chatId is silently dropped. Drain the head and advance.
        // The advance is deferred so that a chat where every handler throws cannot
        // recurse processCurrent -> catch -> processNext -> processCurrent ... and blow
        // the stack; each iteration starts on a fresh task instead.
        try {
            func();
        } catch (err) {
            setImmediate(() => this.processNext(chatId));
            throw err;
        }
    }

    processNext(chatId) {
        const queue = this.queues.get(chatId);
        if (!queue || queue.length === 0) {
            return;
        }

        queue.shift(); // aktuelles Element entfernen

        if (queue.length === 0) {
            this.processing.set(chatId, false);
            return;
        }

        this.processCurrent(chatId);
    }

    // delay in seconds.
    repeatProcessMessage(chatId, delay) {
        const queue = this.queues.get(chatId);
        if (!queue || queue.length === 0) {
            return;
        }

        setTimeout(() => {
            this.processCurrent(chatId);
        }, delay * 1000);
    }

    clear() {
        this.queues.clear();
        this.processing.clear();
    }
}

module.exports = QueueManager;
