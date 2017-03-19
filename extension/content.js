/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function speak_to_me() {

console.log("Speak To Me starting up...");

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error("You need a browser with getUserMedia support to use Speak To Me, sorry!");
    return;
}

const LOCAL_TEST = false;

const stt_server_url = "http://10.252.24.90:9001/asr";

// Encapsulation of the popup we use to provide our UI.
const popup_markup =
`
<div id="stm-popup">
  <button id="stm-stop">Stop</button>
  <div id="stm-list"></div>
</div>
`;

const SpeakToMePopup = {
    init: () => {
        console.log(`SpeakToMePopup init`);
        let popup = document.createElement("div");
        popup.innerHTML = popup_markup;
        document.body.appendChild(popup);
        this.popup = document.getElementById("stm-popup");
        this.list = document.getElementById("stm-list");
    },

    showAt: (x, y) => {
        console.log(`SpeakToMePopup showAt ${x},${y}`);
        this.list.classList.add("hidden");

        let style = this.popup.style;
        style.left = (x + window.scrollX) + "px";
        style.top = (y + window.scrollY) + "px";
        style.display = "block";
    },

    hide: () => {
        console.log(`SpeakToMePopup hide`);
        this.popup.style.display = "none";
    },

    // Returns a Promise that resolves once the "Stop" button is clicked.
    // TODO: replace with silence detection.
    wait_for_stop: () => {
        console.log(`SpeakToMePopup wait_for_stop`);
        return new Promise((resolve, reject) => {
            console.log(`SpeakToMePopup set popup stop listener`);
            let button = document.getElementById("stm-stop");
            button.classList.remove("hidden");
            button.addEventListener("click", function _mic_stop() {
                button.classList.add("hidden");
                button.removeEventListener("click", _mic_stop);
                resolve();
            });
        });
    },

    // Returns a Promise that resolves to the choosen text.
    choose_item: (data) => {
        console.log(`SpeakToMePopup choose_item`);
        return new Promise((resolve, reject) => {
            let html = "<ul class='stm-list'>";
            data.forEach(item => {
                html += `<li>${item.text}</li>`;
            });
            html += "</ul>";
            let list = this.list;
            list.innerHTML = html;
            list.classList.remove("hidden");

            list.addEventListener("click", function _choose_item(e) {
                list.removeEventListener("click", _choose_item);
                if (e.target instanceof HTMLLIElement) {
                    resolve(e.target.textContent);
                }
            });
        });
    }
}

// The icon that we anchor to the currently focused input element.

// TODO: figure out why using a resource in the extensions with browser.extension.getURL() fails.
const mic_icon_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAQAAABLCVATAAABW0lEQVR4Ad2VJXQDMRyHU1Ljzeu6+tnKeTM7NmPUu9CYSQ38ewVXWd/5t7qaoRrz/kkuNyoz/b5cOF+vjMoS7tqY2ohuPG9EZevIW7Ph2AhuwA/BvFXrQ+vwj6F8RZE4USRf0VOc6DlP0RrEUzeiVYij4qIViKPiomWII1/REsRTadEixFNp0QLEk8vhO3WAu8z+RZzoQs2yRrP/mkHEzzhwYG6zf8LhH0dqlnrMHbFMIr+5bUT1mZs//NE8aD0bN0f+DCLWy0AS4y5z5GU35hhk69V/ByxmjnsziRrZDQXJoh7TZtpN5+TVbI0X1arUNqJMYSMUFGw8ydq4tTaCMofYSYiASUC/KpbETQLWfIjYUTahzSRMwOKUHBiUHMgWLMK0OYd/WLyDIQkfeIe7UG7BnSSAP/5KSIB6UH7B7bhLa2TbgQqLAYq4yYqK8IchX59i3BGdfzAoqsEI9//IsA+uNg0AAAAASUVORK5CYII=";

const SpeakToMeIcon = {
    init: () => {
        console.log(`SpeakToMeIcon init`);
        SpeakToMeIcon.icon = document.createElement("div");
        let mic = document.createElement("img");
        mic.src = mic_icon_url;
        SpeakToMeIcon.icon.appendChild(mic);
        SpeakToMeIcon.icon.classList.add("stm-icon");
        SpeakToMeIcon.icon.classList.add("hidden");
        document.body.appendChild(SpeakToMeIcon.icon);

        SpeakToMeIcon.icon.addEventListener("click", on_spm_icon_click);

        document.body.addEventListener("focusin", (event) => {
            let target = event.target;
            // TODO: refine input field detection.
            if (target instanceof HTMLInputElement &&
                ["text", "email"].indexOf(target.type) >= 0) {
                SpeakToMeIcon.anchor_to(target);
            }
        });

        // Check if an element is already focused in the document.
        if (document.hasFocus() && document.activeElement) {
            SpeakToMeIcon.anchor_to(document.activeElement);
        }
    },

    anchor_to: (target) => {
        console.log(`SpeakToMeIcon anchor_to ${target}`);
        let bcr = target.getBoundingClientRect();
        let icon = SpeakToMeIcon.icon;
        let bcr2 = icon.getBoundingClientRect();
        console.log(`bcr: ${bcr.width}x${bcr.height} at ${bcr.left},${bcr.top}`);
        icon.style.left = (bcr.width + bcr.left + window.scrollX - bcr2.width) + "px";
        icon.style.top = (bcr.top + window.scrollY) + "px";
        icon.classList.remove("hidden");
        SpeakToMeIcon._input_field = target;
    },

    get input_field() {
        console.log(`SpeakToMeIcon get::input_field ${SpeakToMeIcon._input_field}`);
        return SpeakToMeIcon._input_field;
    }
}

const on_spm_icon_click = (event) => {
    let constraints = { audio: true };
    let chunks = [];

    navigator.mediaDevices.getUserMedia(constraints)
    .then(function(stream) {
        let options = {
            audioBitsPerSecond : 16000,
            mimeType : "audio/ogg"
        }

        let mediaRecorder = new MediaRecorder(stream, options);

        SpeakToMePopup.showAt(event.clientX, event.clientY);

        SpeakToMePopup.wait_for_stop().then(() => {
            mediaRecorder.stop();
        });

        // TODO: Would be nice to have a wave or fft display.
        // visualize(stream);

        mediaRecorder.start();

        mediaRecorder.onstop = (e) => {
            // We stopped the recording, send the content to the STT server.
            mediaRecorder = null;
            let blob = new Blob(chunks, { "type" : "audio/ogg; codecs=opus" });
            chunks = [];

            if (LOCAL_TEST) {
                let json = JSON.parse('{"status":"ok","data":[{"confidence":0.807493,"text":"PLEASE ADD MILK TO MY SHOPPING LIST"},{"confidence":0.906263,"text":"PLEASE AT MILK TO MY SHOPPING LIST"},{"confidence":0.904414,"text":"PLEASE ET MILK TO MY SHOPPING LIST"}]}');
                if (json.status == "ok") {
                    display_options(json.data);
                }
                return;
            }

            fetch(stt_server_url, {
                method: "POST",
                body: blob
                })
            .then((response) => { return response.json(); })
            .then((json) => {
                console.log(`Got STT result: ${JSON.stringify(json)}`);
                if (json.status == "ok") {
                    display_options(json.data);
                }
            })
            .catch((error) => {
                console.error(`Fetch error: ${error}`);
            });
        }

        mediaRecorder.ondataavailable = (e) => {
            chunks.push(e.data);
        }
    })
    .catch(function(err) {
        console.log(`Recording error: ${err}`);
    });
}

const display_options = (items) => {
    // Filter the array for empty items and normalize the text.
    let data = items.filter((item) => { return item.text != ""; })
                    .map((item) => { return { confidence: item.confidence,
                                              text: item.text.toLowerCase() 
                                             } });

    if (data.length == 0) {
        // TODO: display some failure notification to the user?
        SpeakToMePopup.hide();
        return;
    }

    // if the first result has a high enough confidence, just
    // use it directly.
    if (data[0].confidence > 0.90) {
        SpeakToMeIcon.input_field.value = data[0].text;
        SpeakToMePopup.hide();
        return;
    }

    SpeakToMePopup.choose_item(data).then((text) => {
        SpeakToMeIcon.input_field.value = text;
        // Once a choice is made, close the popup.
        SpeakToMePopup.hide();
    });
}

SpeakToMePopup.init();
SpeakToMeIcon.init();

})();