const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;
require("dotenv").config();

//middle-wares
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Doctor's server is running successfully.");
});

//DB client
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

// //get price after production setup . this is bangla system of adding something after site run
// app.get("/addPrice", async (req, res) => {
//   const update = { $set: { price: 90 } };
//   const result = await Appointments.updateMany({}, update, {
//     upsert: true,
//   });
//   res.send(result);
// });

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
      return res.status(403).send({ message: "Access forbidden" });
    }
    req.decoded = decoded;
    next();
  });
};

//get booking
app.get("/booking", veriFyJWT, async (req, res) => {
  try {
    const email = req.query.email;
    const decodedEmail = req.decoded.email;
    if (email !== decodedEmail) {
      return res.status(403).send({ message: "Access forbidden" });
    }
    const query = { email: email };

    const result = await BookingCollections.find(query).toArray();
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
    const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
      expiresIn: "20h",
    });
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
