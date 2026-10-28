# Reference image names (second batch)

| New name | Was | What to take | What NOT to take |
|---|---|---|---|
| ref-09-faceid-setup-success.png | karenpay-image4.png | One big icon, one headline, two short lines, one button: a calm confirmation step | Teal-green circle, thin outlined button (make the button 64px and filled) |
| ref-10-faceid-settings-green.png | karenpay-image3.png | Plain warning sentence above the toggle: do not enable if someone else's face is registered | Green colour |
| ref-11-faceid-settings-blue.png | karenpay-image2.png | Same warning pattern with larger text | Blue header, green toggle |
| ref-12-dark-payment-amount-success.webp | karenpay-image6.webp | Very large amount, recipient shown under it | Dark gradient theme (light theme only, no gradients behind text), the words "Successfully paid" (use only "Test payment sent"), card and swap widgets |
| palette-01-dusk-indigo-peach-coral.png | karenpay-image5.png | Dusk palette: #312C51, #48426D, #F0C38E, #F1AA9B | Pairing white text on peach or coral |
| palette-02-sunrise-orange-sleep.jpg | karenpay-image5.jpg | Sunrise orange: #FF9F31 / #FFCC6B, text #212121, bg #F1F7FC | White text on orange, orange as text or the only border colour, gradient cards behind text |

Contrast measured with the WCAG formula. Your rule: text at least 7:1, buttons at least 4.5:1.

Palette 1: white on #312C51 13.05:1, white on #48426D 9.23:1, #F0C38E on #312C51 8.02:1, #F1AA9B on #312C51 6.81:1 (passes buttons, below 7:1 for text), #F1AA9B on #48426D 4.82:1 (button only), white on #F0C38E 1.63:1 (fail), white on #F1AA9B 1.92:1 (fail).
Palette 2: #212121 on #F1F7FC 14.91:1, #212121 on #FF9F31 7.86:1, #212121 on #FFCC6B 10.81:1, white on #FF9F31 2.05:1 (fail), #FF9F31 against white or bg 1.90 to 2.05:1 (fails the 3:1 non-text rule).
