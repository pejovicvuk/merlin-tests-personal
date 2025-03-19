import { sleepAsync, toTracked, HtmlControl, MenuContent, showContextMenu, Corner } from '../lib/index.js';
import '../lib/index.js';


class CheckboxModel {
    // check boxes

    red = true;
    blue = false;

    get redAndBlue() {
        return this.red === this.blue ? this.red : undefined;
    }

    set redAndBlue(val: boolean | undefined) {
        if (val === undefined) return;

        this.red = this.blue = val;
    }
}

class TextModel {
    checkBoxes?: CheckboxModel;

    // text

    get hint() {
        const cb = this.checkBoxes;
        return cb === undefined ? 'No checkboxes' :
            cb.red && cb.blue ? 'Red and Blue' :
            this.checkBoxes ? 'Red' :
            this.checkBoxes ? 'Blue' :
            '';
    }

    text = "a";
    
    get oddOrEven() {
        return (this.text.length & 1) === 0 ? 'odd' : 'even';
    }

    // radio

    radio = 0;

    // pickers

    time = "";
    date = "";
    color = "";
    month = "";

    readonly minDate = "2020-01-01";
    readonly maxDate = "2030-01-01";

    isDateValid = false;

    get dateCheck() {
        return this.isDateValid ? this.date : "invalid";
    }

    // validity text

    email = 'bad';

    get emailCustomValidity() {
        const at = this.email.indexOf('@');
        return at <= 0 || at + 1 == this.email.length ? 'Must enter email' : undefined;
    }

    isEmailValid = false;

    get emailValidationMessage(){
        return this.isEmailValid ? 'good' : 'bad';
    }

    // number

    number = "10";
    numberValid = false;

    clicked(ev: MouseEvent) {
        alert(ev.button);
    }

    // disable
    enabled = true;

    array = toTracked(Array.from({ length: 1000 }, (_, i) => ({ 
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

    async onButtonClicked(ev: MouseEvent) {
        ev.stopPropagation();

        const items: (MenuContent | null)[] = [
            'New Text File',
            'New File...',
            'New Window',
            null,
            'Open...',
            {
                text: 'Open Recent', children: ['File #1', 'File #2']
            }
        ];

        const loc = (ev.target as HTMLElement).getBoundingClientRect();

        const ret = await showContextMenu(items, loc.left + window.scrollX, loc.bottom + window.scrollY, Corner.TopLeft);
        console.log(ret);
    }
}

const textModel = toTracked(new TextModel());

const modelControl = document.getElementById('model') as HtmlControl
modelControl.model = textModel;

await sleepAsync(1000);
textModel.checkBoxes = toTracked(new CheckboxModel());

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
