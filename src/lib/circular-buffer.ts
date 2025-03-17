export class CircularBuffer<T> {
    #storage?: (T | undefined)[];
    #pos = 0;
    #length = 0;

    #expand() {
        const oldStorage = this.#storage!;
        let oldLength = oldStorage.length;
        const newStorage = new Array(oldLength << 1);
        
        let reader = this.#pos;
        let writer = 0;
        const mask = oldLength - 1;
        while(oldLength-- > 0) {
            newStorage[writer++] = oldStorage[reader++];
            reader &= mask;
        }

        this.#storage = newStorage;
        this.#pos = 0;
    }

    push(val: T) {
        if (this.#storage === undefined) {
            this.#storage = new Array(4);
        }
        else if (this.#length === this.#storage.length) {
            this.#expand();
        }

        this.#storage[(this.#pos + this.#length++) & (this.#storage.length - 1)] = val;
    }

    pop(): T {
        if (this.#length === 0) throw new Error('Buffer is empty.');

        const storage = this.#storage!;
        const pos = this.#pos;
        const ret = storage[pos]!;
        storage[pos] = undefined;

        this.#pos = (pos + 1) & (storage.length - 1);
        --this.#length;

        return ret;
    }

    get length() {
        return this.#length;
    }

    get(index: number): T {
        if (index < 0 || index >= this.#length) throw new Error('Index out of bounds.');

        return this.#storage![(this.#pos + index) & (this.#length - 1)]!;
    }

    set(index: number, val: T) {
        if (index < 0 || index >= this.#length) throw new Error('Index out of bounds.');

        this.#storage![(this.#pos + index) & (this.#length - 1)] = val;
    }

    clear() {
        const storage = this.#storage;
        if (storage === undefined) return;

        storage.length = 0;
        this.#length = 0;
        this.#pos = 0;
    }
}