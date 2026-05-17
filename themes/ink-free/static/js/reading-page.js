"use strict";

(function () {
    const root = document.querySelector("[data-reading-page]");
    if (!root) return;

    const books = Array.from(root.querySelectorAll("[data-reading-book]"));
    const button = root.querySelector("[data-reading-load-more]");
    const batchSize = Number(root.dataset.batchSize || 12);
    let visible = batchSize;

    function render() {
        books.forEach((book, index) => {
            book.hidden = index >= visible;
        });

        if (button) {
            const hasMore = visible < books.length;
            button.hidden = !hasMore;
            button.textContent = hasMore ? `加载更多（${books.length - visible}）` : "已全部加载";
        }
    }

    if (button) {
        button.addEventListener("click", () => {
            visible += batchSize;
            render();
        });
    }

    render();
})();
