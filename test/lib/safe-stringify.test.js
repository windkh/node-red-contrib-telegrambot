const { describe, it } = require('node:test');
const assert = require('node:assert');
const safeStringify = require('../../telegrambot/lib/safe-stringify');

describe('lib/safe-stringify', function () {
    it('stringifies plain objects normally', function () {
        const out = safeStringify({ a: 1, b: 'two' });
        assert.ok((out).includes('"a": 1'));
        assert.ok((out).includes('"b": "two"'));
    });

    it('honours the indent argument', function () {
        const out = safeStringify({ a: 1 }, 2);
        // 2-space indent => one leading space less than the default 4
        assert.strictEqual(out.split('\n')[1].startsWith('  "a"'), true);
    });

    it('passes through primitives', function () {
        assert.strictEqual(safeStringify(42), '42');
        assert.strictEqual(safeStringify('hi'), '"hi"');
        assert.strictEqual(safeStringify(null), 'null');
        assert.strictEqual(safeStringify(true), 'true');
    });

    it('substitutes "[Circular]" for a self-referential object', function () {
        const a = { name: 'a' };
        a.self = a;
        const out = safeStringify(a);
        assert.ok((out).includes('"[Circular]"'));
        assert.ok((out).includes('"name": "a"'));
    });

    it('substitutes "[Circular]" for nested back-references', function () {
        const root = { kids: [] };
        const child = { parent: root };
        root.kids.push(child);
        const out = safeStringify(root);
        // root is referenced again via child.parent -> placeholder
        assert.ok((out).includes('"[Circular]"'));
        assert.ok((out).includes('"kids"'));
    });

    it('returns valid JSON for circular input (string round-trips through JSON.parse)', function () {
        const a = { name: 'a' };
        a.self = a;
        const parsed = JSON.parse(safeStringify(a));
        assert.strictEqual(parsed.name, 'a');
        assert.strictEqual(parsed.self, '[Circular]');
    });

    it('does not mutate the input object shape', function () {
        const a = { name: 'a' };
        a.self = a;
        const keysBefore = Object.keys(a).slice();
        safeStringify(a);
        assert.deepStrictEqual(Object.keys(a), keysBefore);
        assert.strictEqual(a.self, a); // self-reference preserved
    });

    it('reuses keys when the same object appears as a sibling, not just a circular parent', function () {
        // Telegram payload pattern: msg.originalMessage.chat.pinned_message.chat === msg.chat
        const sharedChat = { id: 123, type: 'private' };
        const payload = {
            chat: sharedChat,
            pinned_message: { chat: sharedChat, text: 'hi' },
        };
        const out = safeStringify(payload);
        // Replacer fires the first time, then [Circular] on the second visit
        assert.ok((out).includes('"id": 123'));
        assert.ok((out).includes('"[Circular]"'));
    });
});
