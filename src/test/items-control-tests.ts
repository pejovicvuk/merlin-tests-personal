import { sleepAsync, toTracked, HtmlControl } from '../lib/index.js';
import '../lib/index.js';


class TextModel {

    // disable
    enabled = true;

    array = toTracked(Array.from({ length: 1000000 }, (_, i) => ({ 
        text: `Item ${i}`,
        index: i 
    })));
    _selectedArrayIndex: number | undefined = 0;

    get selectedArrayIndex() {
        return this._selectedArrayIndex;
    }

    set selectedArrayIndex(val: number | undefined) {
        this._selectedArrayIndex = val;
    }

    async addSeven(ev: MouseEvent) {
        ev.stopPropagation();
        this.array.push({ text: "Item 7", index: this.array.length });
    }
}

const textModel = toTracked(new TextModel());

const modelControl = document.getElementById('model') as HtmlControl
modelControl.model = textModel;

await sleepAsync(1000);

// for (let i = 0; i < 6; i++) {
//     await sleepAsync(1000);
//     textModel.array.push(textModel.array.length + 1);
// }

// await sleepAsync(1000);
// textModel.array[1] = 0;

// await sleepAsync(5000);
// textModel.selectedArrayIndex = 7;

// await sleepAsync(1000);
// textModel.array.splice(2, 0, 9, 9, 9);

// await sleepAsync(1000);
// textModel.array.splice(5, 1);