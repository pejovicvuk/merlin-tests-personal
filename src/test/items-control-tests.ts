import { sleepAsync, toTracked, HtmlControl } from '../lib/index.js';
import '../lib/index.js';


class TextModel {

    // disable
    enabled = true;

    array = toTracked(Array.from({ length: 10000 }, (_, i) => {
        // Create items with varying content to produce different heights
        const type = i % 5; // Create 5 different types of items
        
        switch(type) {
            case 0:
                // Short item
                return { 
                    text: `Item ${i}`,
                    index: i,
                    size: 'small'
                };
            case 1: 
                // Medium item with longer text
                return { 
                    text: `Item ${i} with some additional text that will make this item taller`,
                    index: i,
                    size: 'medium'
                };
            case 2:
                // Large item with much longer text
                return { 
                    text: `Item ${i} with a lot of content. This is a much longer description that will wrap to multiple lines and create a significantly taller item. We're adding even more text to ensure this item takes up more vertical space when rendered.`,
                    index: i,
                    size: 'large'
                };
            case 3:
                // Item with image placeholder (will be taller)
                return { 
                    text: `Item ${i} with image`,
                    hasImage: true,
                    index: i,
                    size: 'large'
                };
            case 4:
                // Extra large item with very long content
                return { 
                    text: `Item ${i} with extremely long content. This item will have multiple paragraphs of text to make it very tall.\n\nThis is a second paragraph for this item. We're adding a lot of text to ensure this item is much taller than the others.\n\nAnd here's even a third paragraph with more content to make this item take up significant vertical space when rendered.`,
                    index: i,
                    isImportant: true,
                    size: 'xlarge'
                };
            default:
                // Add default case to ensure all paths return a value
                return { 
                    text: `Item ${i}`,
                    index: i,
                    size: 'small'
                };
        }
    }));
    _selectedArrayIndex: number | undefined = 0;
 
    get selectedArrayIndex() {
        return this._selectedArrayIndex;
    }

    set selectedArrayIndex(val: number | undefined) {
        this._selectedArrayIndex = val;
    }

}

const textModel = toTracked(new TextModel());

const modelControl = document.getElementById('model') as HtmlControl
modelControl.model = textModel;

await sleepAsync(3000);
textModel.array.splice(3, 1); // Remove the item at index 3
console.log("Removed item at position 3");
await sleepAsync(1000);
textModel.array[1] = { 
    text: "Item 1 (modified)",
    index: 1,
    size: 'small'
};

await sleepAsync(5000);
textModel.selectedArrayIndex = 7;

await sleepAsync(1000);
textModel.array.splice(2, 0, 
  { text: "New Item 1", index: 9, size: 'small' },
  { text: "New Item 2", index: 9, size: 'small' },
  { text: "New Item 3", index: 9, size: 'small' }
);

await sleepAsync(1000);
textModel.array.splice(5, 1);
textModel.array.push({ text: "New Item test", index: 9, size: 'small' });
