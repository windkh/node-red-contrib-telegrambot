class QueueManager {
    constructor() {
        this.queues = new Map();   // chatId -> [funcs]
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
            this._processCurrent(chatId);
        }
    }

    async _processCurrent(chatId) {
        const queue = this.queues.get(chatId);
        if (!queue || queue.length === 0) {
            this.processing.set(chatId, false);
            return;
        }

        this.processing.set(chatId, true);

        const func = queue[0];

        try {
            func();
        } catch (err) {
            console.error("Queue function error:", err);
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

        this._processCurrent(chatId);
    }

    // delay in seconds.
    repeatProcessMessage(chatId, delay) {
        const queue = this.queues.get(chatId);
        if (!queue || queue.length === 0) {
            return;
        }

        setTimeout(() => {
            this._processCurrent(chatId);
        }, delay * 1000);
    }

    clear() {
        this.queues.clear();
        this.processing.clear();
    }
}

module.exports = QueueManager;