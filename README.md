[![progress-banner](https://backend.codecrafters.io/progress/redis/be2458d2-b7ff-460a-a1f9-533375a55eb1)]

## Next Steps 📚

**Want to make it better? Try adding these features (in order of difficulty):**

### Beginner Level (Class 6-8):
1. **DEL command** - Delete a key (like removing a contact from your phone)
2. **EXISTS command** - Check if a key exists (like checking if a contact exists)
3. **KEYS command** - List all keys (like seeing all your contacts)

### Intermediate Level (Class 9-10# Redis Clone - Simple Explanation 🚀

## What is Redis? 🤔

Imagine Redis as a **super-fast chaiwala** who remembers everything! 

**Think of it like this:**
- You have a **magical tapri** (tea stall) 🍵
- The chaiwala remembers EXACTLY how you like your chai (2 spoons sugar, extra strong, with elaichi)
- When you come back, he makes it INSTANTLY without asking
- He remembers orders for THOUSANDS of customers
- The tapri is in your computer's memory (RAM) so it's lightning fast
- Multiple customers can order at the same time

**Real-world examples that every Indian knows:**
- **Swiggy/Zomato**: Redis remembers your favorite restaurants and recent orders
- **PhonePe/Paytm**: Redis stores your login session so you don't have to enter PIN again and again
- **WhatsApp**: Redis stores recent messages and online status
- **Hotstar/Netflix**: Redis remembers where you stopped watching Sacred Games
- **BookMyShow**: Redis holds your seat selection while you're paying (so no one else can book it)

## What is RESP? 🗣️

RESP stands for **REdis Serialization Protocol**. It's like a special language that Redis uses to talk to other programs.

**Think of it like this:**
- You speak Hindi 🇮🇳
- Your South Indian friend speaks Tamil 🇮🇳
- You need Google Translate to understand each other
- RESP is the "Google Translate" between your program and Redis
- Just like how all Indians can communicate in English at airports, all programs communicate with Redis using RESP

### RESP Examples (Don't worry, it looks scary but it's simple!)

**When you want to say "PING" (like checking if chaiwala is awake):**
```
*1\r\n$4\r\nPING\r\n
```
- `*1` means "Boss, I'm sending 1 order"
- `$4` means "The order is 4 letters long"
- `PING` is the actual command
- `\r\n` are just "line endings" (like pressing Enter on your keyboard)

**When you want to say "SET customer_name Rajesh" (like telling chaiwala to remember a customer):**
```
*3\r\n$3\r\nSET\r\n$12\r\ncustomer_name\r\n$6\r\nRajesh\r\n
```
- `*3` means "Boss, I'm sending 3 things"
- First thing: `SET` (3 letters)
- Second thing: `customer_name` (12 letters) 
- Third thing: `Rajesh` (6 letters)

## Why Build a Redis Clone? 🛠️

**Bilkul valid sawal hai!** Here's why:

1. **Jugaad Mentality**: Indians love understanding how things work and making them better (like our famous jugaad!)
2. **Skill Development**: Building your own Redis is like learning to make chai from scratch instead of just buying packets
3. **Cost Saving**: Free Redis clone for your startup (very important for bootstrapped Indian startups!)
4. **Learning**: It's like understanding how your Activa engine works - once you know, you can fix anything!
5. **Customization**: Add features specifically for Indian market (like handling rupee calculations better)

## Why Use Redis CLI Instead of Building Our Own? 🤷‍♂️

**Bahut accha sawal!** Here's the smart reason (typical Indian business strategy):

### Option 1: Build Everything from Scratch 😰 (Like starting your own telecom company)
```
My Program ←→ My Custom Protocol ←→ My Redis Clone
```
- You need to build TWO things: the server AND the client
- It's like Reliance starting from scratch - possible but takes years!
- Other programs can't talk to your Redis because it speaks a different language
- More work, less compatibility
- **Typical Indian parent reaction**: "Itna mehnat kyun kar rahe ho?"

### Option 2: Use Existing Redis CLI (What we did!) 😎 (Like using existing infrastructure)
```
Redis CLI ←→ RESP Protocol ←→ Our Redis Clone
```
- We only build the server (our Redis clone)
- We use the existing Redis CLI (already built and tested)
- It's like using existing railway tracks for your new train
- Anyone who knows Redis can use our clone immediately!
- Less work, more compatibility
- **Smart Indian approach**: "Kaam kam, fayda zyada!"

**Perfect Indian analogy:**
- Instead of building a new type of electrical outlet (like having different plugs for every state), we make our device work with existing outlets
- People can use their existing chargers (Redis CLI) with our device (Redis clone)
- Just like how all phones in India use the same charging port now!

## How This Makes it a "Redis Clone" 🎭

Our server speaks the same language (RESP) as real Redis, so:
- Redis CLI thinks it's talking to real Redis
- Our server responds just like real Redis would
- From the outside, it looks and acts like Redis!

**Perfect Indian example:**
- **Real Redis**: Customer asks "Chai hai?" → "Haan hai!"
- **Our clone**: Customer asks "Chai hai?" → "Haan hai!"
- **Customer can't tell the difference** - both serve the same purpose!

It's like those local Chinese restaurants that taste exactly like the original but are made by Indian chefs. The customer gets the same experience! 🍜

## Commands Explained (Like You're a Class 5 Student!) 👶

### 1. PING Command 🏓
**What it does:** Checks if the server is alive
**Like:** Calling your friend and saying "Sun raha hai?" and they reply "Haan bol!"

**Example:**
```bash
redis-cli PING
```
**Response:** `PONG`

**Real-world use:**
- WhatsApp checking if you're online
- Swiggy checking if restaurant is accepting orders
- Your mom checking if you're awake for morning classes

**In our code:**
```javascript
case "PING": {
  return serializeSimpleString("PONG");
}
```

### 2. ECHO Command 📢
**What it does:** Repeats whatever you say
**Like:** Shouting "Bharat Mata ki" from a hill and hearing "Jai!" back

**Example:**
```bash
redis-cli ECHO "Jai Hind"
```
**Response:** `"Jai Hind"`

**Real-world use:**
- Testing if server is working properly
- Debugging network connections
- Like when you test your mic before a presentation

**In our code:**
```javascript
case "ECHO": {
  if (args.length < 2) {
    return serializeError("ERR wrong number of arguments for 'ECHO'");
  }
  return serializeBulkString(args[1]);
}
```

### 3. SET Command 📝
**What it does:** Saves a value with a name (key)
**Like:** Writing "Rahul" on a sticker and putting it in a box labeled "class_monitor"

**Example:**
```bash
redis-cli SET student_name "Priya"
redis-cli SET marks "95"
redis-cli SET favorite_subject "Maths"
redis-cli SET pocket_money "500"
```
**Response:** `OK`

**With expiration (PX option) - Very Important!**
```bash
redis-cli SET otp_code "123456" PX 300000
```
This saves the OTP but it disappears after 5 minutes (300000 milliseconds)!
**Perfect for:**
- Bank OTPs that expire in 5 minutes
- Paytm login sessions
- BookMyShow seat reservations (expire in 15 minutes)

**In our code:**
```javascript
case "SET": {
  const key = args[1];      // The box label (like "student_name")
  const value = args[2];    // What goes in the box (like "Priya")
  let ttl = null;           // Time to live (expiration)
  
  // Check if they want expiration (like OTP timeout)
  for (let i = 3; i < args.length - 1; i++) {
    if (args[i].toUpperCase() === "PX") {
      ttl = parseInt(args[i + 1], 10);
    }
  }
  
  const record = {
    value,
    expiresAt: ttl ? Date.now() + ttl : null,
  };
  
  store.set(key, record);
  return serializeSimpleString("OK");
}
```

### 4. GET Command 📖
**What it does:** Gets a value by its name (key)
**Like:** Looking for the box labeled "class_monitor" and checking what name is inside

**Example:**
```bash
redis-cli GET student_name
```
**Response:** `"Priya"`

**Real-world examples:**
```bash
redis-cli GET user_session     # Check if user is logged in
redis-cli GET cart_items       # Get items in shopping cart
redis-cli GET last_seen        # When user was last online
redis-cli GET notification_count # Number of unread notifications
```

**If the key doesn't exist:**
```bash
redis-cli GET nonexistent_student
```
**Response:** `(nil)` (which means "kuch nahi mila")

**In our code:**
```javascript
case "GET": {
  const record = store.get(args[1]);
  
  if (!record) {
    return serializeNullBulkString();  // Nothing found
  }
  
  // Check if it expired (like OTP timeout)
  if (record.expiresAt && Date.now() > record.expiresAt) {
    store.delete(args[1]);
    return serializeNullBulkString();  // Expired, so return nothing
  }
  
  return serializeBulkString(record.value);
}
```

### 5. CONFIG Command ⚙️
**What it does:** Shows server configuration settings
**Like:** Asking your friend "Tumhara address kya hai?" or "Phone number kya hai?"

**Example:**
```bash
redis-cli CONFIG GET dir
redis-cli CONFIG GET dbfilename
```
**Response:** Shows the directory and filename settings

**Real-world use:**
- Checking where database files are stored
- Debugging server configuration
- Like checking your phone's storage location

**In our code:**
```javascript
case "CONFIG": {
  const param = args[2];
  let value = null;
  
  if (param === "dir") {
    value = config.dir;
  } else if (param === "dbfilename") {
    value = config.dbfilename;
  }
  
  return `*2\r\n${serializeBulkString(param)}${serializeBulkString(value)}`;
}
```

## How Our Memory Store Works 🧠

We use a JavaScript `Map` as our "magical almirah" (cupboard):

```javascript
const store = new Map();
```

**It's like a well-organized Indian household almirah:**
- Each shelf has a label (key) - like "Mummy ki medicines", "Papa ke documents"
- Each shelf contains a box (record) with:
  - The actual items (value) - like "Crocin tablets", "PAN card"
  - An expiration date (expiresAt) - like "Use before Dec 2024"

**Example storage (very Indian examples):**
```javascript
store.set("student_roll_number", {
  value: "12A45",
  expiresAt: null  // Never expires (like your roll number)
});

store.set("online_exam_session", {
  value: "exam_token_xyz",
  expiresAt: Date.now() + 7200000  // Expires in 2 hours (like online exam time limit)
});

store.set("railway_booking_pnr", {
  value: "PNR123456",
  expiresAt: Date.now() + 300000  // Expires in 5 minutes (like tatkal booking window)
});
```

**Real-world Indian scenarios:**
- **BookMyShow**: Seat selection expires in 15 minutes
- **IRCTC**: Payment session expires if you don't pay quickly
- **Paytm**: Login session expires after some time for security
- **Swiggy**: Restaurant availability changes every few minutes

## How the Server Works 🖥️

**Perfect Indian Call Center Analogy:**

1. **Server starts:** Opens a customer service center on "address" 6379 (Redis's default port)
2. **Client connects:** Like a customer calling the helpline
3. **Client sends query:** Customer explains their problem in proper format
4. **Server understands:** Customer service representative understands the query
5. **Server processes:** Representative finds the solution in their system
6. **Server responds:** Representative gives back the answer in proper format

**The complete flow (like a perfect Indian business transaction):**
```
Customer (Redis CLI) 
    ↓ 
Calls helpline (RESP format)
    ↓ 
Customer service (Our Server)
    ↓ 
Checks database (JavaScript Map)
    ↓ 
Finds answer (Our Server)
    ↓ 
Responds professionally (RESP format)
    ↓ 
Customer satisfied (Redis CLI)
```

**It's exactly like:**
- **Calling Airtel customer care**: You speak in Hindi/English, they understand, check your account, and respond
- **Ordering from Zomato**: You order in the app, restaurant gets it, prepares food, sends back confirmation
- **Using PhonePe**: You send money, server processes, bank confirms, you get notification

## Running the Server 🚀

**Start the server (basic):**
```bash
node server.js
```

**Start with configuration (like a professional setup):**
```bash
node server.js --dir /home/username/redis_data --dbfilename indian_app.rdb
```

**Use Redis CLI to test (try these Indian examples):**
```bash
# Basic health check
redis-cli PING

# Store student information
redis-cli SET student_name "Arjun Sharma"
redis-cli SET student_class "12th"
redis-cli SET student_city "Mumbai"

# Get student information
redis-cli GET student_name
redis-cli GET student_class

# Store temporary data (like OTP)
redis-cli SET login_otp "123456" PX 300000  # Expires in 5 minutes

# Store e-commerce data
redis-cli SET user_cart "laptop,mouse,keyboard"
redis-cli SET payment_session "razorpay_session_abc123" PX 900000  # 15 minutes

# Test echo
redis-cli ECHO "Jai Hind!"
redis-cli ECHO "Redis Clone working perfectly!"

# Check configuration
redis-cli CONFIG GET dir
redis-cli CONFIG GET dbfilename
```

**Expected outputs:**
```
redis-cli PING
→ PONG

redis-cli GET student_name
→ "Arjun Sharma"

redis-cli GET login_otp
→ "123456" (if within 5 minutes)
→ (nil) (if expired)

redis-cli ECHO "Jai Hind!"
→ "Jai Hind!"
```

## Fun Facts! 🎉

1. **Port 6379:** Redis uses this port because it spells "MERZ" on old mobile phones (named after an Italian TV actress) - just like how Indians remember mobile numbers using patterns!

2. **In-Memory Storage:** Everything is stored in RAM, so it's super fast but disappears when you restart - like how your phone's RAM clears when you restart it

3. **Real Redis Speed:** Can handle millions of operations per second - faster than counting currency notes in a bank!

4. **Our Clone:** Handles the basic commands just like real Redis - it's like a perfect duplicate key that works in the same lock!

5. **Indian Connection:** Many Indian startups like Paytm, Flipkart, and Zomato use Redis for their high-speed operations

6. **Memory vs Hard Disk:** Redis is like keeping frequently used items on your study table (fast access) vs keeping them in the cupboard (slower access)

**Interesting Indian Tech Facts:**
- **Flipkart** uses Redis to handle millions of searches during Big Billion Days
- **Paytm** uses Redis for instant payment processing
- **Zomato** uses Redis to track delivery boy locations in real-time
- **Jio** uses Redis-like systems to handle crores of users simultaneously

## What's Missing? 🤷‍♂️

Our clone is simple but missing some Redis features (like a basic smartphone vs iPhone):

**Missing Features:**
- **Persistence** (saving to disk) - like having a backup of your WhatsApp chats
- **More data types** (lists, sets, hashes) - like having different types of containers
- **Pub/Sub** (messaging) - like WhatsApp group notifications
- **Clustering** (multiple servers) - like having multiple bank branches
- **Authentication** (passwords) - like having a PIN for your phone
- **Many more commands** - like having more apps on your phone

**But that's perfectly fine!** 
- We've built the foundation (like building the basic structure of a house)
- Now you understand how Redis works under the hood
- You can add more features as you learn
- Even WhatsApp started with just text messages!

**Indian startup approach:** Start simple, add features gradually, scale when needed! 🚀

## Next Steps 📚

Want to make it better? Try adding:
1. **DEL command** (delete a key)
2. **EXISTS command** (check if a key exists)
3. **KEYS command** (list all keys)
4. **EXPIRE command** (set expiration on existing keys)

Happy coding! 🚀