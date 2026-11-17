(function () {
    const assetBase = 'assets/gifts/';

    function normalizedGiftName(gift) {
        return [gift?.collectionName, gift?.collection_name, gift?.fullName, gift?.name, gift?.title]
            .filter(Boolean).join(' ').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
    }

    function getGiftArtwork(gift) {
        const name = normalizedGiftName(gift);
        if (name.includes('lol pop') || name.includes('lolpop')) return { type: 'animation', label: 'LOL POP' };
        if (name.includes('candy cow') || name.includes('candycow')) return { type: 'image', src: `${assetBase}candy-cow.gif`, label: 'Candy cow' };
        if (/(^| )car( |$)/.test(name) || name.includes('porsche')) return { type: 'image', src: `${assetBase}car.svg`, label: 'CAR' };
        return null;
    }

    function giftArtworkMarkup(gift, className = 'gift-artwork') {
        const artwork = getGiftArtwork(gift);
        if (!artwork) return '';
        if (artwork.type === 'animation') {
            return `<div class="${className} gift-art-animation" data-gift-animation="lol-pop" role="img" aria-label="${artwork.label}"></div>`;
        }
        return `<img class="${className} gift-art-image" src="${artwork.src}" alt="${artwork.label}" loading="lazy">`;
    }

    function mountGiftAnimations(root = document) {
        if (!window.lottie || !root) return;
        root.querySelectorAll('[data-gift-animation="lol-pop"]:not([data-lottie-mounted])').forEach(container => {
            container.dataset.lottieMounted = 'true';
            window.lottie.loadAnimation({ container, renderer: 'svg', loop: true, autoplay: true, path: `${assetBase}lol-pop.json` });
        });
    }

    function replaceStarsInNode(node) {
        if (!node) return;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach(textNode => {
            const parent = textNode.parentElement;
            if (!parent || parent.closest('script,style,noscript,textarea,input,option,code,pre,.app-star-icon')) return;
            const value = textNode.nodeValue;
            if (!value?.includes('⭐')) return;
            const fragment = document.createDocumentFragment();
            value.split(/(⭐\uFE0F?)/g).forEach(part => {
                if (part.startsWith('⭐')) {
                    const icon = document.createElement('img');
                    icon.className = 'app-star-icon';
                    icon.src = `${assetBase}star.svg`;
                    icon.alt = 'Звезда Telegram';
                    icon.setAttribute('role', 'img');
                    fragment.appendChild(icon);
                } else if (part) fragment.appendChild(document.createTextNode(part));
            });
            textNode.replaceWith(fragment);
        });
    }

    function observeStarText() {
        if (!document.body) return;
        replaceStarsInNode(document.body);
        const observer = new MutationObserver(records => records.forEach(record => {
            if (record.type === 'characterData') replaceStarsInNode(record.target.parentElement);
            record.addedNodes?.forEach(added => {
                if (added.nodeType === Node.TEXT_NODE) replaceStarsInNode(added.parentElement);
                else if (added.nodeType === Node.ELEMENT_NODE) replaceStarsInNode(added);
            });
        }));
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }

    window.getGiftArtwork = getGiftArtwork;
    window.giftArtworkMarkup = giftArtworkMarkup;
    window.mountGiftAnimations = mountGiftAnimations;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeStarText, { once: true });
    else observeStarText();
})();
