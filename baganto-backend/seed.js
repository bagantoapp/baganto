// Seed data for Baganto — mirrors the data originally embedded in baganto-barter-app.html
// so the backend and any client (web, Android, iOS) start from the same demo state.
"use strict";

function buildSeed() {
  const now = Date.now();
  const DAY = 86400000, HOUR = 3600000;

  const users = [
    { id: "u1", name: "You", avatar: "🙂", city: "Mumbai, Maharashtra" },
    { id: "u2", name: "Aarav Mehta", avatar: "🧑‍💻", city: "Bengaluru, Karnataka" },
    { id: "u3", name: "Priya Sharma", avatar: "👩‍🎨", city: "Delhi" },
    { id: "u4", name: "Rohan Verma", avatar: "🧑‍🔧", city: "Chennai, Tamil Nadu" },
    { id: "u5", name: "Ananya Iyer", avatar: "👩‍🔬", city: "Pune, Maharashtra" },
    { id: "u6", name: "Karan Singh", avatar: "🧑‍🍳", city: "Jaipur, Rajasthan" }
  ];

  const items = [
    { id: "i1", ownerId: "u1", title: "Hero Sprint Mountain Bike", icon: "🚲", category: "Books, Sports & Hobbies", description: "Hardtail mountain bike, 21-speed, lightly used. New tyres.", forSale: true, price: 4500, forBarter: true, wantInExchange: "Camera, camping gear, or open to offers", city: "Mumbai, Maharashtra", status: "available", createdAt: now - 2 * DAY },
    { id: "i2", ownerId: "u1", title: "Acoustic Guitar", icon: "🎸", category: "Musical Instruments", description: "Full-size acoustic guitar, warm tone, comes with a gig bag and spare strings.", forSale: false, price: null, forBarter: true, wantInExchange: "Keyboard, amp, or open to offers", city: "Mumbai, Maharashtra", status: "available", createdAt: now - 6 * DAY },
    { id: "i3", ownerId: "u2", title: "DSLR Camera Kit", icon: "📷", category: "Electronics & Appliances", description: "Entry-level DSLR with 2 lenses and a carrying case.", forSale: false, price: null, forBarter: true, wantInExchange: "Mountain bike or camping gear", city: "Bengaluru, Karnataka", status: "available", createdAt: now - 4 * DAY },
    { id: "i4", ownerId: "u2", title: "Instant Polaroid Camera", icon: "📷", category: "Electronics & Appliances", description: "Instant camera, barely used, comes with 2 packs of film.", forSale: false, price: null, forBarter: true, wantInExchange: "Vinyl records or board games", city: "Bengaluru, Karnataka", status: "available", createdAt: now - 5 * HOUR },
    { id: "i5", ownerId: "u2", title: "Adjustable Standing Desk", icon: "🪑", category: "Furniture", description: "Manual crank standing desk, sturdy, minor desk-edge scuff.", forSale: true, price: 3000, forBarter: false, wantInExchange: "", city: "Bengaluru, Karnataka", status: "available", createdAt: now - 9 * DAY },
    { id: "i6", ownerId: "u3", title: "Oil Painting Set", icon: "🎨", category: "Other", description: "Full oil painting starter set with easel and canvas pack.", forSale: false, price: null, forBarter: true, wantInExchange: "Yoga mat and weights", city: "Delhi", status: "available", createdAt: now - 3 * DAY },
    { id: "i7", ownerId: "u3", title: "Leather Jacket (M)", icon: "🧥", category: "Fashion", description: "Genuine leather jacket, men's medium, worn a handful of times.", forSale: false, price: null, forBarter: true, wantInExchange: "Sneakers, UK size 9, or open to offers", city: "Delhi", status: "available", createdAt: now - 1 * DAY },
    { id: "i8", ownerId: "u3", title: "5-Shelf Bookcase", icon: "🪑", category: "Furniture", description: "Solid wood bookcase, disassembles easily for transport.", forSale: false, price: null, forBarter: true, wantInExchange: "Small kitchen appliances", city: "Delhi", status: "available", createdAt: now - 12 * DAY },
    { id: "i9", ownerId: "u4", title: "Power Drill Set", icon: "🛠️", category: "Tools & Equipment", description: "Cordless drill with full bit set and spare battery.", forSale: false, price: null, forBarter: true, wantInExchange: "Lawn mower or garden tools", city: "Chennai, Tamil Nadu", status: "available", createdAt: now - 7 * DAY },
    { id: "i10", ownerId: "u4", title: "4-Person Camping Tent", icon: "🏕️", category: "Books, Sports & Hobbies", description: "Waterproof tent, easy setup, used twice.", forSale: false, price: null, forBarter: true, wantInExchange: "Fishing gear", city: "Chennai, Tamil Nadu", status: "available", createdAt: now - 15 * DAY },
    { id: "i11", ownerId: "u4", title: "Board Game Bundle", icon: "🎮", category: "Books, Sports & Hobbies", description: "5 strategy board games, all complete with pieces.", forSale: true, price: 800, forBarter: true, wantInExchange: "Sci-fi or fantasy books", city: "Chennai, Tamil Nadu", status: "available", createdAt: now - 20 * HOUR },
    { id: "i12", ownerId: "u5", title: "Violin with Case", icon: "🎻", category: "Musical Instruments", description: "Student violin, recently restrung, hard case included.", forSale: false, price: null, forBarter: true, wantInExchange: "Keyboard or guitar", city: "Pune, Maharashtra", status: "available", createdAt: now - 8 * DAY },
    { id: "i13", ownerId: "u5", title: "Espresso Coffee Machine", icon: "🍳", category: "Electronics & Appliances", description: "Semi-automatic espresso machine, descaled and ready to go.", forSale: true, price: 6000, forBarter: false, wantInExchange: "", city: "Pune, Maharashtra", status: "available", createdAt: now - 2 * DAY },
    { id: "i14", ownerId: "u5", title: "Kids' Toy Bundle", icon: "🎮", category: "Kids & Baby Care", description: "Large bundle of toddler toys, ages 1-3, all clean and working.", forSale: false, price: null, forBarter: true, wantInExchange: "Baby gear", city: "Pune, Maharashtra", status: "available", createdAt: now - 18 * DAY },
    { id: "i15", ownerId: "u6", title: "Electric Guitar", icon: "🎸", category: "Musical Instruments", description: "Solid-body electric guitar with gig bag, no amp included.", forSale: false, price: null, forBarter: true, wantInExchange: "Synth or drum machine", city: "Jaipur, Rajasthan", status: "available", createdAt: now - 3 * DAY },
    { id: "i16", ownerId: "u6", title: "Suitcase Set", icon: "🧳", category: "Other", description: "3-piece hardshell suitcase set, like new.", forSale: false, price: null, forBarter: true, wantInExchange: "Backpacking gear", city: "Jaipur, Rajasthan", status: "available", createdAt: now - 11 * DAY },
    { id: "i17", ownerId: "u6", title: "Smart Watch", icon: "⌚", category: "Electronics & Appliances", description: "Fitness smart watch, 1 year old, includes charger.", forSale: true, price: 2500, forBarter: true, wantInExchange: "Wireless earbuds or tablet", city: "Jaipur, Rajasthan", status: "available", createdAt: now - 30 * HOUR },
    { id: "i18", ownerId: "u1", title: "Vintage Typewriter", icon: "📝", category: "Other", description: "Working vintage typewriter, recently serviced.", forSale: false, price: null, forBarter: true, wantInExchange: "(already traded)", city: "Mumbai, Maharashtra", status: "traded", createdAt: now - 10 * DAY },
    { id: "i19", ownerId: "u3", title: "Yoga Mat & Weights Set", icon: "🏋️", category: "Books, Sports & Hobbies", description: "Yoga mat plus a set of hand weights.", forSale: false, price: null, forBarter: true, wantInExchange: "(already traded)", city: "Delhi", status: "traded", createdAt: now - 10 * DAY },
    { id: "i20", ownerId: "u6", title: "Bluetooth Speaker", icon: "🔊", category: "Electronics & Appliances", description: "Portable Bluetooth speaker, great bass, barely used.", forSale: true, price: 1500, forBarter: false, wantInExchange: "", city: "Jaipur, Rajasthan", status: "sold", createdAt: now - 15 * DAY },
    { id: "i21", ownerId: "u1", title: "Samsung Galaxy Smartphone", icon: "📱", category: "Mobiles", description: "6 months old, 128GB, no scratches, comes with box and charger.", forSale: true, price: 8000, forBarter: true, wantInExchange: "iPhone, laptop, or open to offers", city: "Mumbai, Maharashtra", status: "available", createdAt: now - 16 * HOUR }
  ];

  const deals = [
    { id: "d1", kind: "barter", fromUserId: "u2", toUserId: "u1", offeredItemId: "i4", requestedItemId: "i1", status: "pending", createdAt: now - 5 * HOUR, completedAt: null },
    { id: "d2", kind: "barter", fromUserId: "u1", toUserId: "u3", offeredItemId: "i18", requestedItemId: "i19", status: "completed", createdAt: now - 10 * DAY, completedAt: now - 7 * DAY },
    { id: "d3", kind: "barter", fromUserId: "u1", toUserId: "u4", offeredItemId: "i2", requestedItemId: "i9", status: "pending", createdAt: now - 1 * DAY, completedAt: null },
    { id: "d4", kind: "sale", fromUserId: "u2", toUserId: "u6", itemId: "i20", price: 1500, status: "completed", createdAt: now - 14 * DAY, completedAt: now - 14 * DAY }
  ];

  const messages = [
    { id: "m1", dealId: "d1", senderId: "u2", text: "Hey! Would you trade your mountain bike for my Polaroid camera? It's barely used, comes with 2 packs of film.", createdAt: now - 5 * HOUR },
    { id: "m2", dealId: "d1", senderId: "u1", text: "That sounds great! What condition is the camera in exactly — any scratches on the lens?", createdAt: now - 3 * HOUR },
    { id: "m3", dealId: "d2", senderId: "u1", text: "Hi Priya, interested in trading my vintage typewriter for your yoga mat & weights set?", createdAt: now - 10 * DAY },
    { id: "m4", dealId: "d2", senderId: "u3", text: "Sure, sounds fun! Let's do it.", createdAt: now - 9.5 * DAY },
    { id: "m5", dealId: "d3", senderId: "u1", text: "Would you consider the drill set for my acoustic guitar? Great condition, includes a spare set of strings and a gig bag.", createdAt: now - 1 * DAY }
  ];

  const ratings = [
    { id: "r1", dealId: "d2", fromUserId: "u1", toUserId: "u3", stars: 5, review: "Smooth trade, exactly as described! Would trade again.", createdAt: now - 7 * DAY },
    { id: "r2", dealId: "d2", fromUserId: "u3", toUserId: "u1", stars: 5, review: "Great trader, fast communication and the typewriter is beautiful.", createdAt: now - 7 * DAY },
    { id: "r3", dealId: "d4", fromUserId: "u2", toUserId: "u6", stars: 5, review: "Fast and easy purchase, speaker works great!", createdAt: now - 14 * DAY }
  ];

  return { users, items, deals, messages, ratings };
}

module.exports = { buildSeed };
