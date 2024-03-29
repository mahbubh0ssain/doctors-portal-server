require("dotenv").config();
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  CURSOR_FLAGS,
} = require("mongodb");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");
const app = express();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//middle-wares
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Doctor's server is running successfully.");
});

//DB client

const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@doctorsportal.qodli8f.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const run = async () => {
  try {
    await client.connect();
    console.log("DB connected successfully");
  } catch (err) {
    console.error(err);
  }
};
run();

//send booking email function
const sendBookingEmail = (bookingInfo) => {
  const { email, treatmentName, selectedDate, slot } = bookingInfo;
  const auth = {
    //mailgun er kaj karbar koresi ekhane
    auth: {
      api_key: process.env.API_KEY,
      domain: process.env.EMAIL_SENDER_DOMAIN,
    },
  };

  const transporter = nodemailer.createTransport(mg(auth));

  transporter.sendMail(
    {
      from: "mahbubh0ssain.dev@gmail.com", // sender address
      to: email,
      subject: `Your appointment for ${treatmentName} is confirmed.`,
      text: "Hello!", // plain text body
      html: `
    <h3>Your appointment is confirmed</h3>
    <div>
    <p>Please visit us at ${selectedDate} at ${slot} </p>
    <p>Thanks from Doctor's Portal</p>
    </div>
    `,
    },
    (error, info) => {
      if (error) {
        console.log(error);
      } else {
        console.log(`Response: ${info.response}`);
      }
    }
  );
};

//appointments
const Appointments = client
  .db("DoctorsPortal")
  .collection("appointmentOptions");

//booking
const BookingCollections = client
  .db("DoctorsPortal")
  .collection("bookingCollections");

//users
const UsersCollection = client
  .db("DoctorsPortal")
  .collection("usersCollection");

//doctors
const DoctorsCollection = client
  .db("DoctorsPortal")
  .collection("doctorsCollection");

// payments collection
const PaymentCollection = client
  .db("DoctorsPortal")
  .collection("paymentCollection");

// post payment info
app.post("/paymentInfo", async (req, res) => {
  const info = req.body;
  const result = await PaymentCollection.insertOne(info);
  const update = {
    $set: {
      paid: true,
    },
  };
  const bookingUpdate = await BookingCollections.updateOne(
    { _id: ObjectId(info.bookingId) },
    update,
    {
      upsert: true,
    }
  );
  res.send(result);
});

// verifyAdmin
const verifyAdmin = async (req, res, next) => {
  const decodedEmail = req.decoded.email;
  const query = { email: decodedEmail };
  //check whether admin or not
  const user = await UsersCollection.findOne(query);
  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Access forbidden." });
  }
  next();
};

//get appointment
app.get("/appointmentOptions", async (req, res) => {
  try {
    const date = req.query.date;

    const options = await Appointments.find({}).toArray();

    const bookingQuery = { selectedDate: date };

    const alreadyBooked = await BookingCollections.find(bookingQuery).toArray();

    options.forEach((option) => {
      const optionBooked = alreadyBooked.filter(
        (book) => book.treatmentName === option.name
      );

      const bookedSlot = optionBooked.map((book) => book.slot);

      const remainingSlots = option.slots.filter(
        (slot) => !bookedSlot.includes(slot)
      );

      option.slots = remainingSlots;
    });

    if (options) {
      res.send({
        success: true,
        data: options,
      });
    } else {
      res.send({
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    res.send({
      success: false,
      message: err.message,
    });
  }
});

//get specialty

app.get("/specialty", async (req, res) => {
  const result = await Appointments.find({}).project({ name: 1 }).toArray();
  res.send(result);
});

// verify JWT
const veriFyJWT = (req, res, next) => {
  const headerToken = req.headers.authorization;
  if (!headerToken) {
    return res.status(401).send({ message: "Unauthorized access." });
  }
  const token = headerToken.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Access Forbidden" });
    }
    req.decoded = decoded;
    next();
  });
};

// create payment intent
app.post("/create-payment-intent", async (req, res) => {
  const price = req.body.price;
  const amount = price * 100;
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method_types: ["card"],
  });
  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

//get booking
app.get("/booking", veriFyJWT, async (req, res) => {
  try {
    const email = req.query.email;
    const decodedEmail = req.decoded.email;
    if (email !== decodedEmail) {
      return res.status(403).send({ message: "Access forbidden" });
    }
    const result = await BookingCollections.find({ email: email }).toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
  }
});

// get specific booking
app.get("/bookings/:id", async (req, res) => {
  const id = req.params.id;
  const result = await BookingCollections.findOne({ _id: ObjectId(id) });
  res.send(result);
});

//post booking
app.post("/bookings", async (req, res) => {
  try {
    const bookingInfo = req.body;
    const query = {
      selectedDate: bookingInfo.selectedDate,
      email: bookingInfo.email,
      treatmentName: bookingInfo.treatmentName,
    };
    const alreadyBooked = await BookingCollections.find(query).toArray();
    if (alreadyBooked.length) {
      res.send({
        acknowledged: false,
        message: `You already booked on ${bookingInfo.selectedDate}`,
      });
      return;
    }
    const result = await BookingCollections.insertOne(bookingInfo);
    if (result?.acknowledged) {
      // send email about booking confirmation
      sendBookingEmail(bookingInfo);
      res.send({
        success: true,
        data: result,
      });
    } else {
      res.send({
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    res.send({
      success: false,
      message: err.message,
    });
  }
});

//post users
app.post("/users", async (req, res) => {
  const user = req.body;
  const isExist = await UsersCollection.findOne({ email: user?.email });
  if (isExist) {
    return;
  }
  const result = await UsersCollection.insertOne(user);
  res.send(result);
});

// get all users
app.get("/users", async (req, res) => {
  const users = await UsersCollection.find({}).toArray();
  res.send(users);
});

//jwt
app.get("/jwt", async (req, res) => {
  const email = req.query.email;
  const isExist = await UsersCollection.findOne({ email: email });
  if (isExist) {
    const token = jwt.sign({ email }, process.env.ACCESS_TOKEN);
    return res.send({ token });
  }
  return res.status(401).send({ message: "Access forbidden." });
});

//getSingle User
app.get("/users/admin/:email", async (req, res) => {
  const user = await UsersCollection.findOne({ email: req.params.email });
  res.send({ isAdmin: user?.role === "admin" });
});

//make admin
app.put("/users/admin/:id", veriFyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const update = { $set: { role: "admin" } };
  const result = await UsersCollection.updateOne(
    { _id: ObjectId(id) },
    update,
    {
      upsert: true,
    }
  );
  res.send(result);
});

app.post("/doctors", veriFyJWT, verifyAdmin, async (req, res) => {
  try {
    const doctor = req.body;
    const result = await DoctorsCollection.insertOne(doctor);
    res.send(result);
  } catch (err) {
    console.log(err);
  }
});

app.get("/doctors", veriFyJWT, verifyAdmin, async (req, res) => {
  const result = await DoctorsCollection.find({}).toArray();
  res.send(result);
});

app.delete("/doctors/:id", veriFyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await DoctorsCollection.deleteOne({ _id: ObjectId(id) });
  res.send(result);
});

app.listen(port, () => {
  console.log("Doctor's server is running on port", port);
});
