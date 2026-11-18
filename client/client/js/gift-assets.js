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

    // The database uses collection names (Car/Cars/Caps/etc.), while image folders
    // use their historical case-sensitive names.
    function modelFolder(name) {
        const value = String(name || '').trim();
        const aliases = {
            car: 'Cars', cars: 'Cars',
            cap: 'Cap', caps: 'Cap',
            pencil: 'Pencil', pencils: 'Pencil',
            pepe: 'Pepe', pepes: 'Pepe'
        };
        return aliases[value.toLowerCase()] || value;
    }

    function getModelImagePath(collectionName, fileName) {
        if (!fileName) return '';
        const value = String(fileName).trim().replace(/\\/g, '/');
        if (/^https?:\/\//i.test(value)) return value;
        const raw = value.replace(/^\/+/, '').replace(/^m_nft_image\//i, '');
        const parts = raw.split('/').filter(part => part && part !== '.' && part !== '..');
        if (!parts.length) return '';
        if (parts.length === 1) {
            if (!collectionName) return '';
            parts.unshift(modelFolder(collectionName));
        } else {
            parts[0] = modelFolder(parts[0]);
        }
        const lastIndex = parts.length - 1;
        if (!/\.(png|webp|jpe?g|avif)$/i.test(parts[lastIndex])) {
            parts[lastIndex] += parts[0] === 'Cars' ? '.webp' : '.PNG';
        }
        return '/m_nft_image/' + parts.map(encodeURIComponent).join('/');
    }

    async function fetchNFTModels() {
        const response = await fetch('https://mnft-bot-backend.vercel.app/api/models', {
            mode: 'cors',
            cache: 'no-cache'
        });
        if (!response.ok) throw new Error(`Model catalog HTTP ${response.status}`);
        const result = await response.json();
        if (!result.success || !Array.isArray(result.models)) {
            throw new Error('Invalid model catalog response');
        }
        return result.models;
    }

    async function fetchNFTCollections() {
        const response = await fetch('https://mnft-bot-backend.vercel.app/api/collections', {
            mode: 'cors',
            cache: 'no-cache'
        });
        if (!response.ok) throw new Error(`NFT collections HTTP ${response.status}`);
        const result = await response.json();
        if (!result.success || !Array.isArray(result.collections)) {
            throw new Error('Invalid NFT collections response');
        }
        return result.collections;
    }

    function getNFTNumberRibbonStyle(nft) {
        // Match the diagonal number stripe to the actual NFT card background.
        const background = nft?.backgroundData || {};
        const base = background.back_0 || background.back_100 ||
            (typeof window.getRarityColor === 'function'
                ? window.getRarityColor(nft?.rarity)
                : '#6950a1');
        const validHex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(String(base));
        if (!validHex) return '--nft-ribbon-bg:#594186';
        let hex = String(base).replace(/^#/, '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
        // Darken slightly for white-number contrast, retaining background hue.
        const darkened = channels.map(v => Math.min(255, Math.max(0, Math.round(v * 0.68))));
        const color = '#' + darkened.map(v => v.toString(16).padStart(2, '0')).join('');
        return '--nft-ribbon-bg:' + color;
    }

    function nftNumberRibbonMarkup(nft) {
        const raw = nft?.number;
        if (raw === undefined || raw === null || String(raw).trim() === '') return '';
        const number = String(raw).replace(/[^0-9]/g, '').slice(0, 12);
        if (!number) return '';
        return `<div class="nft-number-ribbon" style="${getNFTNumberRibbonStyle(nft)}" aria-label="NFT номер ${number}"><span>#${number}</span></div>`;
    }

    function getNFTUpgradeCost(nft) {
        return 5;
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
    window.getModelImagePath = getModelImagePath;
    window.fetchNFTModels = fetchNFTModels;
    window.fetchNFTCollections = fetchNFTCollections;
    window.nftNumberRibbonMarkup = nftNumberRibbonMarkup;
    window.getNFTUpgradeCost = getNFTUpgradeCost;
    window.giftArtworkMarkup = giftArtworkMarkup;
    window.mountGiftAnimations = mountGiftAnimations;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeStarText, { once: true });
    else observeStarText();
})();
